import SwiftUI
import UIKit

@main
struct MafiaHubApp: App {
    private let server: MafiaHotspotServer

    init() {
        // Keep host iPhone awake initially while creating/setting up lobby until roles are assigned
        UIApplication.shared.isIdleTimerDisabled = true
        self.server = MafiaHotspotServer(port: 8080) { keepAwake in
            UIApplication.shared.isIdleTimerDisabled = keepAwake
        }
        self.server.start()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
