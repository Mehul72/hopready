import XCTest

// Shared steps for the UI tests. They run against a Release simulator build (the JavaScript bundle
// is embedded, no development server); see docs/testing.md.
class HopReadyTestCase: XCTestCase {
  var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    app = XCUIApplication()
  }

  // MARK: - Steps

  func planDriveAndParkTrip() {
    openTab("Plan")
    tapWhenReady(element("place-field-origin"))
    chooseInPlaceSheet(search: "Box Hill")
    tapWhenReady(element("place-field-destination"))
    chooseInPlaceSheet(search: "Chatswood")
    // "I'll drive and park" is on by default, and every test starts from deleted data.
    XCTAssertTrue(element("access-drive").waitForExistence(timeout: 5))
    departAtMidMorning()
    tapWhenReady(element("plan-button"))
    XCTAssertTrue(element("results-screen").waitForExistence(timeout: 10))
  }

  func parkAndRideOption() -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Drive and park'")).firstMatch
  }

  // The demo timetable has no services between about 1.30 am and 4.30 am, so a fixed departure
  // keeps the journey independent of when the tests run. The picker never goes before now.
  func departAtMidMorning() {
    tapWhenReady(labelled("Depart at"))
    // React Native puts the test ID on a wrapper; the compact picker inside has a date button and
    // a time button such as "1:35 am".
    let picker = element("time-picker").datePickers.firstMatch
    XCTAssertTrue(picker.waitForExistence(timeout: 5), "The departure time picker is missing")
    let time = picker.buttons.matching(
      NSPredicate(format: "label MATCHES %@", "\\d{1,2}:\\d{2}\\s?[ap]m")
    ).firstMatch
    tapWhenReady(time)
    let wheels = app.pickerWheels
    XCTAssertTrue(wheels.firstMatch.waitForExistence(timeout: 5))
    setWheel(wheels.element(boundBy: 0), to: "10")
    setWheel(wheels.element(boundBy: 1), to: "00")
    if wheels.count > 2 { setWheel(wheels.element(boundBy: 2), to: "am") }
    // Tapping outside the popover closes it.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap()
    // iOS writes "10:00 am" with a narrow no-break space before "am".
    let shownTime = time.label.replacingOccurrences(of: "\u{202F}", with: " ")
    XCTAssertEqual(shownTime, "10:00 am", "The departure time was not set")
  }

  // A single wheel adjustment can stop a few rows short (7 to 9 instead of 10 on the iOS 27
  // simulator), so it is repeated until the wheel shows the wanted value. Minutes read "12 minutes".
  func setWheel(_ wheel: XCUIElement, to wanted: String, attempts: Int = 6) {
    func reads(_ value: String) -> Bool {
      let shown = wheel.value as? String ?? ""
      if let number = Int(value) { return Int(shown.prefix(while: \.isNumber)) == number }
      return shown.hasPrefix(value)
    }
    for _ in 0..<attempts where !reads(wanted) {
      wheel.adjust(toPickerWheelValue: wanted)
    }
    XCTAssertTrue(reads(wanted), "The wheel stopped at \(wheel.value ?? "nothing"), not \(wanted)")
  }

  // The Plan tab's search and the Saved and Take me home pickers label their search fields
  // "Search for a place or stop" and "Search for a place".
  func chooseInPlaceSheet(search text: String) {
    let input = app.textFields.matching(
      NSPredicate(format: "identifier == %@ OR label BEGINSWITH %@", "place-search-input", "Search for a")
    ).firstMatch
    XCTAssertTrue(input.waitForExistence(timeout: 10), "The place search sheet did not open")
    typeChecked(text, into: input)
    let result = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    XCTAssertTrue(result.waitForExistence(timeout: 10), "No search result for \(text)")
    result.tap()
  }

  func deleteAllData() {
    openTab("Settings")
    let delete = app.buttons["Delete all HopReady data"]
    scrollTo(delete)
    delete.tap()
    tapWhenReady(app.alerts.buttons["Delete everything"])
  }

  func turnOnDemoMode() {
    openTab("Settings")
    let toggle = app.switches["Demo mode"]
    scrollTo(toggle)
    if toggle.value as? String != "1" { toggle.tap() }
    XCTAssertEqual(toggle.value as? String, "1", "Demo mode did not turn on")
  }

  func allowOrDenyLocation(allow: Bool) {
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let alert = springboard.alerts.firstMatch
    guard alert.waitForExistence(timeout: 5) else { return }
    let label = allow ? "Allow While Using App" : "Don’t Allow"
    alert.buttons[label].tap()
  }

  // MARK: - Helpers

  // The first keyboard of a run can drop a keystroke ("Bx Hill"), so what was typed is checked and
  // typed again if it came out wrong.
  func typeChecked(_ text: String, into field: XCUIElement, attempts: Int = 3) {
    for _ in 0..<attempts {
      field.tap()
      field.typeText(text)
      let typed = field.value as? String ?? ""
      if typed == text { return }
      if typed != field.placeholderValue {
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: typed.count))
      }
    }
    XCTFail("Could not type \(text) into \(field)")
  }

  func keepScreenshot(_ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  func element(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any)[identifier].firstMatch
  }

  // Segments and chips are radio and toggle buttons in React Native, which XCUITest does not
  // always report as buttons, so they are found by their accessibility label.
  func labelled(_ label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  // Screens opened from a tab cover the tab bar; going back reveals it again.
  func returnToTabs() {
    for _ in 0..<4 where !app.tabBars.firstMatch.isHittable {
      app.navigationBars.buttons.element(boundBy: 0).tap()
    }
  }

  func openTab(_ title: String) {
    let tab = app.tabBars.buttons[title]
    XCTAssertTrue(tab.waitForExistence(timeout: 30), "Missing the \(title) tab")
    tab.tap()
  }

  func tapWhenReady(_ target: XCUIElement, timeout: TimeInterval = 10) {
    XCTAssertTrue(target.waitForExistence(timeout: timeout), "Not found: \(target)")
    target.tap()
  }

  // Drags from low on the screen, where screens keep their lists, so a map in the middle of the
  // screen is not panned instead of the list being scrolled.
  func scrollListTo(_ target: XCUIElement, attempts: Int = 6) {
    for _ in 0..<attempts where !(target.exists && target.isHittable) {
      scrollPageDown()
    }
    XCTAssertTrue(target.isHittable, "Could not scroll to \(target)")
  }

  func scrollPageDown() {
    let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.82))
    let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.32))
    start.press(forDuration: 0.05, thenDragTo: end)
  }

  // Looks above the current position first, then below, so it works wherever the screen was left.
  func scrollTo(_ target: XCUIElement, attempts: Int = 8) {
    for _ in 0..<attempts where !(target.exists && target.isHittable) {
      app.swipeDown()
    }
    for _ in 0..<attempts where !(target.exists && target.isHittable) {
      app.swipeUp()
    }
    XCTAssertTrue(target.isHittable, "Could not scroll to \(target)")
  }
}
