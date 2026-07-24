import Foundation
import ScreenCaptureKit
import CoreMedia

// LiveTranscript macOS system-audio helper.
//
// Captures the system output mix (what's playing — e.g. the Zoom desktop app)
// via ScreenCaptureKit and writes raw mono Float32 48kHz little-endian PCM to
// stdout with NO header. The Rust parent (src-tauri/src/macos_capture.rs)
// converts to 16-bit PCM and forwards it over the Tauri IPC channel to the web
// UI's ASR pipeline.
//
// Design notes:
//  - This is the battle-tested "SystemAudioDump" pattern shipped by open-source
//    Cluely clones (glass, cheating-daddy): a tiny standalone SCK binary piping
//    PCM to stdout, isolated in its own process so a capture crash can't take
//    down the app.
//  - It is a PASSIVE tap of the output mixer — it never seizes the mic or the
//    output device, so Zoom keeps working and there's no echo/feedback.
//  - Diagnostics go to stderr so they never corrupt the PCM byte stream.
//  - When Rust closes the read end of our stdout, the default SIGPIPE
//    terminates us — that's the clean stop path.
@available(macOS 13.0, *)
final class AudioCapturer: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private let out = FileHandle.standardOutput

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            FileHandle.standardError.write("no display\n".data(using: .utf8)!)
            exit(1)
        }
        // Exclude our own app so we never capture our own output (no feedback).
        let myPID = ProcessInfo.processInfo.processIdentifier
        let myApp = content.applications.first { $0.processID == myPID }
        let filter = SCContentFilter(
            display: display,
            excludingApplications: myApp.map { [$0] } ?? [],
            exceptingWindows: [])

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 48_000
        config.channelCount = 1              // SCK downmixes to mono for us
        config.excludesCurrentProcessAudio = true
        config.width = 2; config.height = 2  // minimal video; no video handler attached

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio,
                                   sampleHandlerQueue: DispatchQueue(label: "audio.pcm"))
        try await stream.startCapture()
        self.stream = stream
        // Readiness sentinel on stderr: capture is live. The Rust parent waits for
        // this before telling the frontend audio is flowing — so a denied
        // Screen-Recording permission (start throws, no READY) surfaces as a
        // failure and the app falls back instead of silently recording nothing.
        FileHandle.standardError.write("READY\n".data(using: .utf8)!)
    }

    func stream(_ stream: SCStream,
                didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }
        var blockBuffer: CMBlockBuffer?
        var abl = AudioBufferList()
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &abl,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer)
        guard status == noErr else { return }
        let list = UnsafeMutableAudioBufferListPointer(&abl)
        guard let buf = list.first, let data = buf.mData, buf.mDataByteSize > 0 else { return }
        out.write(Data(bytes: data, count: Int(buf.mDataByteSize)))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write("stopped: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}

guard #available(macOS 13.0, *) else {
    FileHandle.standardError.write("requires macOS 13+\n".data(using: .utf8)!)
    exit(1)
}
let capturer = AudioCapturer()
Task {
    do { try await capturer.start() }
    catch {
        FileHandle.standardError.write("start failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}
dispatchMain()  // keep alive; SCK delivers on its own queue
