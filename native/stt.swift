// Transcribe an audio file with macOS on-device speech recognition.
// usage: stt <audio-file> [locale]
// Callbacks arrive on the main queue, so we pump the run loop instead of blocking it.
import Foundation
import Speech

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

// Run the main loop until `check` returns a value, or the deadline passes.
func pump<T>(_ seconds: TimeInterval, _ check: () -> T?) -> T? {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        if let value = check() { return value }
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
    }
    return check()
}

let args = CommandLine.arguments
guard args.count > 1 else { fail("usage: stt <audio-file>") }
let url = URL(fileURLWithPath: args[1])
guard FileManager.default.fileExists(atPath: url.path) else { fail("no-such-file") }

var status: SFSpeechRecognizerAuthorizationStatus?
SFSpeechRecognizer.requestAuthorization { status = $0 }
guard let auth = pump(60, { status }) else { fail("authorization-timeout") }
guard auth == .authorized else { fail("not-authorized:\(auth.rawValue)") }

let id = args.count > 2 ? args[2] : "en-US"
guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: id)) else { fail("no-recognizer:\(id)") }
guard pump(10, { recognizer.isAvailable ? true : nil }) == true else { fail("recognizer-unavailable") }

let request = SFSpeechURLRecognitionRequest(url: url)
request.shouldReportPartialResults = false
// Stay on-device when this locale supports it.
request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition

var text: String?
var failure: String?
recognizer.recognitionTask(with: request) { result, error in
    if let error = error { failure = error.localizedDescription; return }
    if let result = result, result.isFinal { text = result.bestTranscription.formattedString }
}
guard let done = pump(120, { text ?? failure }) else { fail("transcription-timeout") }
if failure != nil { fail(done) }
print(done)
