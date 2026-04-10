"""
server.py v3 — YT Music Saver
Thêm: Library DB lưu ở server, file watcher tự đồng bộ khi xoá file
"""

import http.server, json, threading, uuid, os, shutil, tempfile, platform
import subprocess, sqlite3, sys, time, hashlib
import yt_dlp
from urllib.parse import urlparse, parse_qs

PORT         = 9876
BASE_DIR     = r"D:\Extensions\yt-music-extension"
DOWNLOAD_DIR = os.path.join(BASE_DIR, "YT-Music")
DB_PATH      = os.path.join(BASE_DIR, "library.db")

os.makedirs(DOWNLOAD_DIR, exist_ok=True)

jobs        = {}
_server_ref = None

FORMAT_MAP = {
    "mp3":     {"format":"bestaudio/best","postprocessors":[{"key":"FFmpegExtractAudio","preferredcodec":"mp3","preferredquality":"192"}]},
    "m4a":     {"format":"bestaudio[ext=m4a]/bestaudio/best","postprocessors":[]},
    "mp4_720": {"format":"bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best","postprocessors":[]},
    "mp4_1080":{"format":"bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best","postprocessors":[]},
}


# ═══════════════════════════════════════════════════════════════
# LIBRARY DATABASE — lưu ở server, source of truth
# ═══════════════════════════════════════════════════════════════

def db_connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def db_init():
    with db_connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS library (
                video_id  TEXT PRIMARY KEY,
                title     TEXT,
                channel   TEXT,
                thumbnail TEXT,
                genre     TEXT,
                format    TEXT,
                filename  TEXT,
                date      TEXT
            )
        """)
        conn.commit()

def db_get_all():
    with db_connect() as conn:
        rows = conn.execute("SELECT * FROM library ORDER BY rowid DESC").fetchall()
    return [dict(r) for r in rows]

def db_add(video_id, title, channel, thumbnail, genre, fmt, filename, date):
    with db_connect() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO library
            (video_id, title, channel, thumbnail, genre, format, filename, date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (video_id, title, channel, thumbnail, genre, fmt, filename, date))
        conn.commit()

def db_remove(video_id):
    with db_connect() as conn:
        conn.execute("DELETE FROM library WHERE video_id = ?", (video_id,))
        conn.commit()

def db_check(video_id):
    """Trả về record nếu tồn tại VÀ file thực tế vẫn còn, None nếu không."""
    with db_connect() as conn:
        row = conn.execute("SELECT * FROM library WHERE video_id = ?", (video_id,)).fetchone()
    if not row:
        return None
    # Kiểm tra file thực tế
    filepath = os.path.join(DOWNLOAD_DIR, row["filename"])
    if not os.path.exists(filepath):
        # File đã bị xoá bên ngoài → xoá khỏi DB luôn
        db_remove(video_id)
        return None
    return dict(row)

def db_sync_with_folder():
    """
    Đồng bộ DB với thư mục YT-Music:
    - Xoá record nào mà file đã bị xoá khỏi thư mục
    Trả về list video_id đã bị xoá.
    """
    removed = []
    with db_connect() as conn:
        rows = conn.execute("SELECT video_id, filename FROM library").fetchall()
    for row in rows:
        filepath = os.path.join(DOWNLOAD_DIR, row["filename"])
        if not os.path.exists(filepath):
            db_remove(row["video_id"])
            removed.append(row["video_id"])
            print(f"[SYNC] Xoá khỏi DB (file đã mất): {row['filename']}")
    return removed


# ═══════════════════════════════════════════════════════════════
# FILE WATCHER — theo dõi thư mục YT-Music
# ═══════════════════════════════════════════════════════════════

_watcher_snapshot = {}   # filename -> mtime

def _take_snapshot():
    snap = {}
    try:
        for f in os.listdir(DOWNLOAD_DIR):
            fp = os.path.join(DOWNLOAD_DIR, f)
            if os.path.isfile(fp):
                snap[f] = os.path.getmtime(fp)
    except Exception:
        pass
    return snap

def _file_watcher():
    global _watcher_snapshot
    _watcher_snapshot = _take_snapshot()
    while True:
        time.sleep(3)
        try:
            current = _take_snapshot()
            # Tìm file bị xoá
            deleted = set(_watcher_snapshot) - set(current)
            if deleted:
                for fname in deleted:
                    # Tìm record có filename này
                    with db_connect() as conn:
                        row = conn.execute(
                            "SELECT video_id FROM library WHERE filename = ?", (fname,)
                        ).fetchone()
                    if row:
                        db_remove(row["video_id"])
                        print(f"[WATCHER] File bị xoá: {fname} → đã xoá khỏi DB")
            _watcher_snapshot = current
        except Exception as e:
            print(f"[WATCHER] Lỗi: {e}")

def start_watcher():
    t = threading.Thread(target=_file_watcher, daemon=True)
    t.start()


# ═══════════════════════════════════════════════════════════════
# COOKIE
# ═══════════════════════════════════════════════════════════════

def copy_locked_file_windows(src, dst):
    try:
        r = subprocess.run(
            ["robocopy", os.path.dirname(src), os.path.dirname(dst),
             os.path.basename(src), "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"],
            capture_output=True, timeout=10)
        return r.returncode <= 1 and os.path.exists(dst)
    except:
        return False

def export_youtube_cookies_from_db(db_path, out_txt):
    try:
        conn = sqlite3.connect(db_path)
        cur  = conn.cursor()
        cur.execute("""SELECT host_key,path,is_secure,expires_utc,name,encrypted_value,value
                       FROM cookies
                       WHERE host_key LIKE '%youtube.com%' OR host_key LIKE '%google.com%'""")
        rows = cur.fetchall(); conn.close()
        if not rows: return False
        with open(out_txt, "w", encoding="utf-8") as f:
            f.write("# Netscape HTTP Cookie File\n")
            for host, path, secure, expires, name, enc_val, val in rows:
                cookie_val = val if val else ""
                if not cookie_val: continue
                unix_exp = max(0, (expires - 11644473600000000) // 1000000) if expires else 0
                f.write(f"{host}\tTRUE\t{path}\t{'TRUE' if secure else 'FALSE'}\t{unix_exp}\t{name}\t{cookie_val}\n")
        return os.path.getsize(out_txt) > 50
    except Exception as e:
        print(f"[!] Export cookie DB lỗi: {e}"); return False

def get_cookie_file():
    if platform.system() != "Windows":
        home = os.path.expanduser("~")
        for src in [
            os.path.join(home, "Library", "Application Support", "Google", "Chrome", "Default", "Cookies"),
            os.path.join(home, ".config", "google-chrome", "Default", "Cookies")
        ]:
            if os.path.exists(src):
                try:
                    tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
                    shutil.copy2(src, tmp.name); tmp.close(); return tmp.name
                except: pass
        return None

    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        os.path.join(local, "Google",       "Chrome",        "User Data", "Default", "Network", "Cookies"),
        os.path.join(local, "Google",       "Chrome",        "User Data", "Default", "Cookies"),
        os.path.join(local, "Microsoft",    "Edge",          "User Data", "Default", "Network", "Cookies"),
        os.path.join(local, "Microsoft",    "Edge",          "User Data", "Default", "Cookies"),
        os.path.join(local, "BraveSoftware","Brave-Browser", "User Data", "Default", "Network", "Cookies"),
    ]
    for src in candidates:
        if not os.path.exists(src): continue
        tmp_db  = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False); tmp_db.close()
        tmp_txt = tempfile.NamedTemporaryFile(suffix=".txt",    delete=False); tmp_txt.close()
        copied  = copy_locked_file_windows(src, tmp_db.name)
        if not copied:
            try: shutil.copy2(src, tmp_db.name); copied = True
            except Exception as e: print(f"[!] Copy cookie thất bại: {e}")
        if copied:
            ok = export_youtube_cookies_from_db(tmp_db.name, tmp_txt.name)
            try: os.unlink(tmp_db.name)
            except: pass
            if ok:
                print(f"[i] Cookie OK từ {'Chrome' if 'Chrome' in src else 'Edge' if 'Edge' in src else 'Brave'}")
                return tmp_txt.name
            try: os.unlink(tmp_txt.name)
            except: pass
    return None


# ═══════════════════════════════════════════════════════════════
# DOWNLOAD WORKER
# ═══════════════════════════════════════════════════════════════

def download_worker(job_id, url, fmt, meta):
    jobs[job_id]["status"] = "downloading"
    cfg = FORMAT_MAP.get(fmt, FORMAT_MAP["mp3"])
    cookie_file = None

    def hook(d):
        if d["status"] == "downloading":
            downloaded = d.get("downloaded_bytes", 0) or 0
            total      = d.get("total_bytes", 0) or d.get("total_bytes_estimate", 0) or 0
            if total > 0:
                pct = round(downloaded / total * 100, 1)
            else:
                try: pct = float(d.get("_percent_str","0%").strip().replace("%",""))
                except: pct = 0
            speed_bps = d.get("speed", 0) or 0
            if speed_bps > 1024*1024:
                speed_str = f"{speed_bps/1024/1024:.1f} MB/s"
            elif speed_bps > 1024:
                speed_str = f"{speed_bps/1024:.0f} KB/s"
            else:
                speed_str = d.get("_speed_str","").strip()
            jobs[job_id]["percent"] = pct
            jobs[job_id]["speed"]   = speed_str
        elif d["status"] == "finished":
            jobs[job_id]["percent"] = 100
            jobs[job_id]["speed"]   = ""

    opts = {
        "format":         cfg["format"],
        "outtmpl":        os.path.join(DOWNLOAD_DIR, "%(title)s.%(ext)s"),
        "progress_hooks": [hook],
        "quiet":          True,
        "no_warnings":    True,
        "noplaylist":     True,
        "playlist_items": "1",
    }
    cookie_file = get_cookie_file()
    if cookie_file: opts["cookiefile"] = cookie_file
    else: print("[!] Không lấy được cookie.")
    if cfg["postprocessors"]: opts["postprocessors"] = cfg["postprocessors"]

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info     = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            if fmt == "mp3": filename = os.path.splitext(filename)[0] + ".mp3"
            basename = os.path.basename(filename)

            # Lưu vào library DB
            from datetime import date
            db_add(
                video_id  = meta.get("videoId", ""),
                title     = meta.get("title",   info.get("title", "")),
                channel   = meta.get("channel", ""),
                thumbnail = meta.get("thumbnail", ""),
                genre     = meta.get("genre",   "Khác"),
                fmt       = fmt,
                filename  = basename,
                date      = date.today().strftime("%d/%m/%Y")
            )

            jobs[job_id]["status"]   = "done"
            jobs[job_id]["filename"] = basename
            print(f"[OK] {basename}")
    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"]  = str(e)
        print(f"[ERR] {e}")
    finally:
        if cookie_file and os.path.exists(cookie_file):
            try: os.unlink(cookie_file)
            except: pass


# ═══════════════════════════════════════════════════════════════
# URL CLEANUP
# ═══════════════════════════════════════════════════════════════

def clean_youtube_url(url):
    """
    Kiểm tra và làm sạch YouTube URL.
    Trích xuất video ID từ nhiều định dạng YouTube URL khác nhau.
    Raise ValueError nếu URL không hợp lệ.
    """
    if not url:
        raise ValueError("URL không được để trống")
    
    url = url.strip()
    
    # Hỗ trợ các định dạng: youtube.com, youtu.be, youtube-nocookie.com
    valid_hosts = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube.com', 'www.youtu.be']
    
    parsed = urlparse(url)
    
    # Nếu không có scheme, thêm https://
    if not parsed.scheme:
        url = "https://" + url
        parsed = urlparse(url)
    
    # Kiểm tra host
    host = parsed.netloc.lower().replace('www.', '')
    if host not in [h.replace('www.', '') for h in valid_hosts]:
        raise ValueError(f"URL không phải YouTube: {url}")
    
    # Trích xuất query params
    query_params = parse_qs(parsed.query)
    
    # Trích xuất video ID
    if 'youtu.be' in host:
        # Định dạng: https://youtu.be/dQw4w9WgXcQ
        video_id = parsed.path.lstrip('/')
    else:
        # Định dạng: https://youtube.com/watch?v=dQw4w9WgXcQ
        # Nếu có list parameter, chỉ tải video đầu tiên (tham số v)
        video_id = query_params.get('v', [None])[0]
    
    if not video_id or len(video_id) != 11:
        raise ValueError(f"Không tìm thấy video ID hợp lệ trong URL: {url}")
    
    # Trả về URL chuẩn (bỏ qua tham số list nếu có)
    return f"https://www.youtube.com/watch?v={video_id}"


# ═══════════════════════════════════════════════════════════════
# HTTP HANDLER
# ═══════════════════════════════════════════════════════════════

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type",   "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self): self.send_json({})

    def do_GET(self):
        if self.path == "/ping":
            self.send_json({"ok": True, "version": "3.0"})

        elif self.path.startswith("/progress/"):
            jid = self.path.split("/progress/")[1]
            self.send_json(jobs.get(jid, {"error": "không tồn tại"}))

        # Lấy toàn bộ library (đã sync với folder)
        elif self.path == "/library":
            removed = db_sync_with_folder()
            data    = db_get_all()
            self.send_json({"library": data, "removed": removed})

        # Kiểm tra 1 video có trùng không
        elif self.path.startswith("/check/"):
            vid = self.path.split("/check/")[1]
            rec = db_check(vid)
            self.send_json({"exists": rec is not None, "record": rec})

        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body   = json.loads(self.rfile.read(length)) if length else {}

        if self.path == "/download":
            try:
                clean_url = clean_youtube_url(body.get("url", ""))
            except ValueError as e:
                self.send_json({"error": str(e)}, 400); return

            # Kiểm tra trùng trước khi tải
            vid = urlparse(clean_url)
            vid = parse_qs(vid.query).get("v", [None])[0]
            if vid:
                existing = db_check(vid)
                if existing and not body.get("force", False):
                    self.send_json({"duplicate": True, "record": existing})
                    return

            jid = str(uuid.uuid4())[:8]
            jobs[jid] = {"status": "queued", "percent": 0, "speed": "", "filename": "", "error": ""}
            meta = {
                "videoId":   body.get("videoId",   vid or ""),
                "title":     body.get("title",     ""),
                "channel":   body.get("channel",   ""),
                "thumbnail": body.get("thumbnail", ""),
                "genre":     body.get("genre",     "Khác"),
            }
            threading.Thread(
                target=download_worker,
                args=(jid, clean_url, body.get("format","mp3"), meta),
                daemon=True
            ).start()
            print(f"[+] Job {jid} | {body.get('format','mp3').upper()} | {clean_url}")
            self.send_json({"job_id": jid})

        elif self.path == "/shutdown":
            self.send_json({"ok": True})
            print("\n[!] Shutdown được yêu cầu từ extension.")
            threading.Thread(target=_server_ref.shutdown, daemon=True).start()

        else:
            self.send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        # Xoá 1 record khỏi DB (không xoá file)
        if self.path.startswith("/library/"):
            vid = self.path.split("/library/")[1]
            db_remove(vid)
            self.send_json({"ok": True, "removed": vid})
        else:
            self.send_json({"error": "not found"}, 404)


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    db_init()
    # Sync ngay khi khởi động
    removed = db_sync_with_folder()
    if removed:
        print(f"[SYNC] Đã xoá {len(removed)} record do file không còn tồn tại")
    # Bắt đầu watcher
    start_watcher()

    server      = http.server.HTTPServer(("localhost", PORT), Handler)
    _server_ref = server
    print(f"""
╔══════════════════════════════════════╗
║      YT Music Saver Server v3        ║
╠══════════════════════════════════════╣
║  🟢 Đang chạy tại localhost:{PORT}    ║
║  📁 {DOWNLOAD_DIR}
║  🗃  DB: {DB_PATH}
║  ⌨  Ctrl+C để dừng                   ║
╚══════════════════════════════════════╝
""")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Server đã dừng.")