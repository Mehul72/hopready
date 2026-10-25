import XCTest

// Runs against a Release simulator build (the JavaScript bundle is embedded, no dev server).
// See docs/testing.md for the commands.
final class HopReadyLaunchTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testLaunchShowsTheFourTabs() throws {
    let app = XCUIApplication()
    app.launch()

    let tabBar = app.tabBars.firstMatch
    XCTAssertTrue(tabBar.waitForExistence(timeout: 30), "The tab bar never appeared")
    for title in ["Plan", "Car", "Saved", "Settings"] {
      XCTAssertTrue(tabBar.buttons[title].exists, "Missing the \(title) tab")
    }
  }
}
