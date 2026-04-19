import Foundation
import UserNotifications

@MainActor
final class EmberNotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    var onOpenActiveAssessment: (() -> Void)?

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let route = response.notification.request.content.userInfo["ember_route"] as? String
        if route == "active_assessment" {
            onOpenActiveAssessment?()
        }
    }
}
