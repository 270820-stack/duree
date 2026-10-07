// Long-running localhost bridge for the Durée selected-clock tick.
// One short NSHapticFeedbackManager tap per request. Bind is 127.0.0.1 only.
//
//   swiftc -O -framework AppKit -o haptic-bridge haptic-bridge.swift
//   ./haptic-bridge
//
// GET http://127.0.0.1:8767/tap  → alignment haptic (local http page)
// GET https://127.0.0.1:8768/tap → same handler via haptic-https.py
// GET /health → tap count, no haptic
//
// GitHub Pages is https, so the browser blocks http://127.0.0.1 as mixed content.
// Approve the one Keychain prompt trusting "Duree Local Haptic CA" or https taps stay blocked.

import AppKit
import Darwin
import Foundation

let hapticPort: UInt16 = 8767
let hapticTLSPort: UInt16 = 8768
var httpsProxy: Process?
var trustProc: Process?
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

func certDirectory() -> URL {
    let dir = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/duree-haptic", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: dir.path)
    return dir
}

@discardableResult
func runTool(_ path: String, _ args: [String], cwd: URL) -> Int32 {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: path)
    proc.arguments = args
    proc.currentDirectoryURL = cwd
    proc.standardOutput = FileHandle.nullDevice
    let err = Pipe()
    proc.standardError = err
    do { try proc.run() } catch {
        fail("\(path): \(error)")
    }
    proc.waitUntilExit()
    if proc.terminationStatus != 0 {
        let data = err.fileHandleForReading.readDataToEndOfFile()
        let msg = String(data: data, encoding: .utf8) ?? "failed"
        fail("\(path) \(args.first ?? ""): \(msg)")
    }
    return proc.terminationStatus
}

func ensureCertificates(_ dir: URL) -> (crt: String, key: String, ca: String) {
    let crt = dir.appendingPathComponent("server.crt").path
    let key = dir.appendingPathComponent("server.key").path
    let ca = dir.appendingPathComponent("ca.crt").path
    let caKey = dir.appendingPathComponent("ca.key").path
    let fm = FileManager.default
    if fm.fileExists(atPath: crt) && fm.fileExists(atPath: key) && fm.fileExists(atPath: ca) && fm.fileExists(atPath: caKey) {
        return (crt, key, ca)
    }
    runTool("/usr/bin/openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "3650", "-nodes",
        "-keyout", "ca.key", "-out", "ca.crt",
        "-subj", "/CN=Duree Local Haptic CA",
        "-addext", "basicConstraints=critical,CA:TRUE",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign"
    ], cwd: dir)
    runTool("/usr/bin/openssl", [
        "req", "-newkey", "rsa:2048", "-nodes",
        "-keyout", "server.key", "-out", "server.csr",
        "-subj", "/CN=127.0.0.1"
    ], cwd: dir)
    let ext = """
    basicConstraints=CA:FALSE
    keyUsage=digitalSignature,keyEncipherment
    extendedKeyUsage=serverAuth
    subjectAltName=IP:127.0.0.1,DNS:localhost

    """
    try? ext.write(to: dir.appendingPathComponent("server.ext"), atomically: true, encoding: .utf8)
    runTool("/usr/bin/openssl", [
        "x509", "-req", "-in", "server.csr",
        "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial",
        "-out", "server.crt", "-days", "825", "-sha256",
        "-extfile", "server.ext"
    ], cwd: dir)
    try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: caKey)
    try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: key)
    return (crt, key, ca)
}

func findHTTPSScript() -> String? {
    let fm = FileManager.default
    var dirs = [fm.currentDirectoryPath]
    let exe = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    dirs.append(exe.deletingLastPathComponent().path)
    for dir in dirs {
        let path = URL(fileURLWithPath: dir).appendingPathComponent("haptic-https.py").path
        if fm.fileExists(atPath: path) { return path }
    }
    return nil
}

func loginKeychainPath() -> String {
    FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Keychains/login.keychain-db").path
}

func certificateTrusted(serverCrt: String) -> Bool {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/security")
    proc.arguments = ["verify-cert", "-c", serverCrt, "-p", "ssl", "-k", loginKeychainPath(), "-L"]
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    do { try proc.run() } catch { return false }
    proc.waitUntilExit()
    return proc.terminationStatus == 0
}

func trustLocalCA(_ caPath: String) {
    if trustProc != nil { return }
    fputs("duree haptic: approve the Keychain prompt to trust \"Duree Local Haptic CA\" (once). Until then https://127.0.0.1:\(hapticTLSPort)/tap is blocked.\n", stderr)
    fflush(stderr)
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/security")
    proc.arguments = [
        "add-trusted-cert", "-r", "trustRoot", "-p", "ssl",
        "-k", loginKeychainPath(), caPath
    ]
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    trustProc = proc
    do { try proc.run() } catch {
        fputs("duree haptic: could not request Keychain trust: \(error)\n", stderr)
    }
}

func startHTTPSProxy() {
    let dir = certDirectory()
    let certs = ensureCertificates(dir)
    guard let script = findHTTPSScript() else {
        fputs("duree haptic: haptic-https.py not found; https taps unavailable\n", stderr)
        return
    }
    guard FileManager.default.fileExists(atPath: "/usr/bin/python3") else {
        fputs("duree haptic: /usr/bin/python3 missing; https taps unavailable\n", stderr)
        return
    }
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
    proc.arguments = [
        script,
        "--listen", String(hapticTLSPort),
        "--upstream", String(hapticPort),
        "--cert", certs.crt,
        "--key", certs.key,
        "--ppid", String(getpid())
    ]
    proc.standardInput = FileHandle.nullDevice
    proc.standardOutput = FileHandle.standardOutput
    proc.standardError = FileHandle.standardError
    do { try proc.run() } catch {
        fputs("duree haptic: https proxy failed: \(error)\n", stderr)
        return
    }
    httpsProxy = proc
    Thread.sleep(forTimeInterval: 0.2)
    if !proc.isRunning {
        fputs("duree haptic: https proxy exited\n", stderr)
        return
    }
    if !certificateTrusted(serverCrt: certs.crt) {
        trustLocalCA(certs.ca)
    }
}

let listenFD = makeListener()
print("duree haptic listening on http://127.0.0.1:\(hapticPort)")
startHTTPSProxy()
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
