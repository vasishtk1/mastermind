//
//  Ember-Bridging-Header.h
//  Ember
//
//  Exposes the Cactus C API to Swift. In Xcode, set:
//  - Objective-C Bridging Header = Ember/Ember-Bridging-Header.h
//  - Header Search Paths = $(SRCROOT)/../cactus/cactus (recursive: no)
//

#ifndef Ember_Bridging_Header_h
#define Ember_Bridging_Header_h

#import <Foundation/Foundation.h>

// C API only — do not import cactus.h here (it pulls C++ headers Swift cannot bridge).
#import "ffi/cactus_ffi.h"

#endif /* Ember_Bridging_Header_h */
