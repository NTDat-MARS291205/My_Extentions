"""
native_host.py — Native Messaging Host cho YT Music Saver
Chrome gọi script này khi extension dùng chrome.runtime.connectNative()
Script này sẽ khởi động server.py dưới dạng subprocess ẩn
"""

import sys, json, struct, subprocess, os, time

def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len: return None
    msg_len = struct.unpack('<I', raw_len)[0]
    return json.loads(sys.stdin.buffer.read(msg_len))

def write_message(msg):
    data = json.dumps(msg).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

def main():
    # native_host.py nằm trong native-host/
    # server.py nằm trong server/ (thư mục anh em)
    base_dir   = os.path.dirname(os.path.abspath(__file__))
    server_py  = os.path.join(base_dir, '..', 'server', 'server.py')
    server_py  = os.path.normpath(server_py)
    python_exe = sys.executable

    # Ghi log lỗi ra file để debug nếu cần
    log_path = os.path.join(base_dir, 'native_host.log')

    if not os.path.exists(server_py):
        write_message({'status': 'error', 'message': f'Khong tim thay server.py tai: {server_py}'})
        return

    while True:
        msg = read_message()
        if msg is None: break

        action = msg.get('action', '')

        if action == 'start':
            try:
                si = None
                if sys.platform == 'win32':
                    si = subprocess.STARTUPINFO()
                    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                    si.wShowWindow = subprocess.SW_HIDE

                proc = subprocess.Popen(
                    [python_exe, server_py],
                    startupinfo=si,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
                    cwd=os.path.dirname(server_py),
                )

                time.sleep(1.5)

                write_message({
                    'status': 'started',
                    'pid': proc.pid
                })

            except Exception as e:
                write_message({'status': 'error', 'message': str(e)})
        elif action == 'ping':
            write_message({'status': 'ok'})

        else:
            write_message({'status': 'error', 'message': f'Unknown action: {action}'})

if __name__ == '__main__':
    main()