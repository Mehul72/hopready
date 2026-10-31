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

// Also run at the largest Dynamic Type size and in dark appearance, as documented in testing.md.
final class HopReadyAccessibilityTests: HopReadyTestCase {
  func testPlannerControlsAreReachable() throws {
    app.launch()
    deleteAllData()
    turnOnDemoMode()
    openTab("Plan")
    keepScreenshot("10-plan-accessibility")

    let time = element("plan-time-toggle")
    scrollListTo(time)
    time.tap()
    let arrive = labelled("Arrive by")
    scrollListTo(arrive)
    XCTAssertTrue(arrive.isHittable)
    keepScreenshot("11-time-accessibility")
    scrollTo(time)
    time.tap()

    let travel = element("plan-travel-toggle")
    scrollListTo(travel)
    travel.tap()
    let dropOff = element("access-dropOff")
    scrollListTo(dropOff)
    XCTAssertTrue(dropOff.isHittable)
    keepScreenshot("12-travel-accessibility")
    scrollTo(travel)
    travel.tap()

    let plan = element("plan-button")
    scrollListTo(plan)
    XCTAssertTrue(plan.isHittable)
    keepScreenshot("13-plan-action-accessibility")
  }
}
