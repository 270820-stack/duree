#!/usr/bin/env python3
# TLS front for the Durée haptic bridge. Binds 127.0.0.1 only and
# forwards each request to the HTTP listener. Browsers still need the
# local CA trusted once or they abort before this process sees the tap.

import argparse
import os
import socket
import ssl
import threading
import time


def watch_parent(ppid):
    while True:
        if os.getppid() != ppid:
            os._exit(0)
        time.sleep(1)


def read_headers(conn):
    buf = b""
    while b"\r\n\r\n" not in buf and len(buf) < 8192:
        chunk = conn.recv(2048)
        if not chunk:
            break
        buf += chunk
    return buf


def handle(ctx, client, upstream_port):
    tls = None
    up = None
    try:
        client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        tls = ctx.wrap_socket(client, server_side=True)
        tls.settimeout(0.4)
        req = read_headers(tls)
        if not req:
            return
        up = socket.create_connection(("127.0.0.1", upstream_port), timeout=0.4)
        up.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        up.sendall(req)
        up.shutdown(socket.SHUT_WR)
        while True:
            chunk = up.recv(4096)
            if not chunk:
                break
            tls.sendall(chunk)
    except Exception:
        pass
    finally:
        for sock in (up, tls, client):
            if sock is None:
                continue
            try:
                sock.close()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen", type=int, required=True)
    parser.add_argument("--upstream", type=int, required=True)
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--ppid", type=int, default=0)
    args = parser.parse_args()

    if args.ppid > 0:
        threading.Thread(target=watch_parent, args=(args.ppid,), daemon=True).start()

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(args.cert, args.key)
    try:
        ctx.set_alpn_protocols(["http/1.1"])
    except Exception:
        pass

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", args.listen))
    server.listen(128)
    print("duree haptic https listening on 127.0.0.1:%d" % args.listen, flush=True)

    while True:
        try:
            client, _ = server.accept()
        except OSError:
            continue
        threading.Thread(
            target=handle, args=(ctx, client, args.upstream), daemon=True
        ).start()


if __name__ == "__main__":
    main()
