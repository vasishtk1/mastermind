import Foundation
import Darwin

/// Best-effort physical memory footprint for the current process (bytes).
enum MemoryFootprint {
    static func currentBytes() -> UInt64 {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return 0 }
        return UInt64(info.phys_footprint)
    }

    static func currentMegabytes() -> Double {
        let b = currentBytes()
        return Double(b) / (1024.0 * 1024.0)
    }
}
