// Long-running localhost bridge for the Durée selected-clock tick.
// One short NSHapticFeedbackManager tap per request. Bind is 127.0.0.1 only.
//
//   swiftc -O -framework AppKit -o haptic-bridge haptic-bridge.swift
//   ./haptic-bridge
//
// GET /tap  → alignment haptic, performanceTime .now
// GET /health → tap count, no haptic

import AppKit
import Darwin
import Foundation

let hapticPort: UInt16 = 8767
let tapLock = NSLock()
var tapCount = 0

func fail(_ message: String) -> Never {
    fputs("duree haptic: \(message)\n", stderr)
    exit(1)
}

func performTapOnMain() {
    let run = {
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        tapLock.lock()
        tapCount += 1
        tapLock.unlock()
    }
    if Thread.isMainThread {
        run()
        return
    }
    let sem = DispatchSemaphore(value: 0)
    DispatchQueue.main.async {
        run()
        sem.signal()
    }
    _ = sem.wait(timeout: .now() + .milliseconds(200))
}

func currentTapCount() -> Int {
    tapLock.lock()
    let n = tapCount
    tapLock.unlock()
    return n
}

func writeAll(_ fd: Int32, _ text: String) {
    let bytes = Array(text.utf8)
    bytes.withUnsafeBytes { raw in
        guard let base = raw.baseAddress else { return }
        var off = 0
        while off < bytes.count {
            let n = write(fd, base.advanced(by: off), bytes.count - off)
            if n < 0 {
                if errno == EINTR { continue }
                break
            }
            if n == 0 { break }
            off += n
        }
    }
}

func respond(_ fd: Int32, status: String, body: String) {
    let resp = "HTTP/1.1 \(status)\r\n" +
        "Access-Control-Allow-Origin: *\r\n" +
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
        "Access-Control-Allow-Headers: *\r\n" +
        "Access-Control-Allow-Private-Network: true\r\n" +
        "Content-Length: \(body.utf8.count)\r\n" +
        "Connection: close\r\n" +
        "Cache-Control: no-store\r\n" +
        "\r\n" +
        body
    writeAll(fd, resp)
}

func handleClient(_ fd: Int32) {
    var one: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
    var tv = timeval(tv_sec: 0, tv_usec: 30_000)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

    var buf = [UInt8](repeating: 0, count: 1024)
    let n = read(fd, &buf, buf.count)
    let req = n > 0 ? (String(bytes: buf[0..<n], encoding: .utf8) ?? "") : ""
    let line = req.split(separator: "\r\n", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
    let parts = line.split(separator: " ")
    let method = parts.count > 0 ? String(parts[0]) : ""
    let rawPath = parts.count > 1 ? String(parts[1]) : "/"
    let path = String(rawPath.split(separator: "?", maxSplits: 1).first ?? Substring(rawPath))

    if method == "OPTIONS" {
        respond(fd, status: "204 No Content", body: "")
        return
    }
    if (method == "GET" || method == "POST") && path == "/tap" {
        performTapOnMain()
        respond(fd, status: "204 No Content", body: "")
        return
    }
    if method == "GET" && (path == "/" || path == "/health") {
        respond(fd, status: "200 OK", body: "taps \(currentTapCount())\n")
        return
    }
    respond(fd, status: "404 Not Found", body: "")
}

func makeListener() -> Int32 {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    if fd < 0 { fail("socket: \(String(cString: strerror(errno)))") }

    var yes: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = hapticPort.bigEndian
    if inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr) != 1 {
        fail("inet_pton 127.0.0.1")
    }

    let bound: Int32 = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sap in
            bind(fd, sap, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    if bound != 0 { fail("bind 127.0.0.1:\(hapticPort): \(String(cString: strerror(errno)))") }
    if listen(fd, 128) != 0 { fail("listen: \(String(cString: strerror(errno)))") }
    return fd
}

let listenFD = makeListener()
print("duree haptic listening on 127.0.0.1:\(hapticPort)")
fflush(stdout)

DispatchQueue.global(qos: .userInteractive).async {
    while true {
        let cfd = accept(listenFD, nil, nil)
        if cfd < 0 {
            if errno == EINTR { continue }
            usleep(1000)
            continue
        }
        DispatchQueue.global(qos: .userInteractive).async {
            handleClient(cfd)
            close(cfd)
        }
    }
}

NSApplication.shared.setActivationPolicy(.accessory)
NSApplication.shared.run()
