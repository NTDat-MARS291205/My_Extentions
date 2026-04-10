"""
server.py v2 — YT Music Saver local server
Thêm: /shutdown endpoint để extension tắt server được
"""

import http.server, json, threading, uuid, os, shutil, tempfile, platform, subprocess, sqlite3, sys
import yt_dlp
from urllib.parse import urlparse, parse_qs

PORT         = 9876
BASE_DIR     = r"D:\Extensions\yt-music-extension"
DOWNLOAD_DIR = os.path.join(BASE_DIR, "YT-Music")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

jobs        = {}
_server_ref = None

FORMAT_MAP = {
    "mp3":     {"format":"bestaudio/best","postprocessors":[{"key":"FFmpegExtractAudio","preferredcodec":"mp3","preferredquality":"192"}]},
    "m4a":     {"format":"bestaudio[ext=m4a]/bestaudio/best","postprocessors":[]},
    "mp4_720": {"format":"bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best","postprocessors":[]},
    "mp4_1080":{"format":"bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best","postprocessors":[]},
}


def clean_youtube_url(url):
    p = urlparse(url); qs = parse_qs(p.query)
    vid = qs.get("v", [None])[0]
    if not vid: raise ValueError("URL không chứa video ID hợp lệ.")
    return f"https://www.youtube.com/watch?v={vid}"


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

        copied = copy_locked_file_windows(src, tmp_db.name)
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


def download_worker(job_id, url, fmt):
    jobs[job_id]["status"] = "downloading"
    cfg = FORMAT_MAP.get(fmt, FORMAT_MAP["mp3"])
    cookie_file = None

    def hook(d):
        if d["status"] == "downloading":
            # Dùng bytes thực tế thay _percent_str (ổn định hơn trên yt-dlp mới)
            downloaded = d.get("downloaded_bytes", 0) or 0
            total      = d.get("total_bytes", 0) or d.get("total_bytes_estimate", 0) or 0
            if total > 0:
                pct = round(downloaded / total * 100, 1)
            else:
                # Fallback dùng _percent_str nếu không có bytes
                try: pct = float(d.get("_percent_str", "0%").strip().replace("%",""))
                except: pct = 0
            # Format speed dễ đọc
            speed_bps = d.get("speed", 0) or 0
            if speed_bps > 1024*1024:
                speed_str = f"{speed_bps/1024/1024:.1f} MB/s"
            elif speed_bps > 1024:
                speed_str = f"{speed_bps/1024:.0f} KB/s"
            else:
                speed_str = d.get("_speed_str", "").strip()
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
            jobs[job_id]["status"]   = "done"
            jobs[job_id]["filename"] = os.path.basename(filename)
            print(f"[OK] {os.path.basename(filename)}")
    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"]  = str(e)
        print(f"[ERR] {e}")
    finally:
        if cookie_file and os.path.exists(cookie_file):
            try: os.unlink(cookie_file)
            except: pass


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send_json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type",   "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self): self.send_json({})

    def do_GET(self):
        if   self.path == "/ping":
            self.send_json({"ok": True, "version": "2.0"})
        elif self.path.startswith("/progress/"):
            jid = self.path.split("/progress/")[1]
            self.send_json(jobs.get(jid, {"error": "không tồn tại"}))
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
            jid = str(uuid.uuid4())[:8]
            jobs[jid] = {"status": "queued", "percent": 0, "speed": "", "filename": "", "error": ""}
            threading.Thread(target=download_worker, args=(jid, clean_url, body.get("format","mp3")), daemon=True).start()
            print(f"[+] Job {jid} | {body.get('format','mp3').upper()} | {clean_url}")
            self.send_json({"job_id": jid})

        elif self.path == "/shutdown":
            self.send_json({"ok": True})
            print("\n[!] Shutdown được yêu cầu từ extension.")
            threading.Thread(target=_server_ref.shutdown, daemon=True).start()

        else:
            self.send_json({"error": "not found"}, 404)


if __name__ == "__main__":
    server      = http.server.HTTPServer(("localhost", PORT), Handler)
    _server_ref = server
    print(f"""
╔══════════════════════════════════════╗
║      YT Music Saver Server v2        ║
╠══════════════════════════════════════╣
║  🟢 Đang chạy tại localhost:{PORT}    ║
║  📁 Lưu vào: ~/Downloads/YT-Music    ║
║  ⌨  Ctrl+C để dừng                   ║
╚══════════════════════════════════════╝
""")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Server đã dừng.")