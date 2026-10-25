import XCTest

// Runs only against a build made with EXPO_PUBLIC_API_BASE_URL pointing at a local API that serves
// the demo fixtures (HOPREADY_MODE=demo pnpm api:dev). It covers what the on-device demo cannot:
// the agreement screen, and searches and trips that travel over HTTP through the real API.
final class HopReadyLiveApiTests: HopReadyTestCase {
  func testAgreeingThenPlanningThroughTheApi() throws {
    app.launch()
    let agree = app.buttons["Agree and continue"]
    if !agree.waitForExistence(timeout: 10) {
      // Agreed in an earlier run, or a build with no API address, which never asks.
      deleteAllData()
      try XCTSkipUnless(
        agree.waitForExistence(timeout: 10),
        "This build has no API address, so there is no live mode to test")
    }
    keepScreenshot("live-01-agreement")
    agree.tap()

    planDriveAndParkTrip()
    let option = app.buttons.matching(
      NSPredicate(format: "identifier BEGINSWITH %@", "route-card-")
    ).firstMatch
    XCTAssertTrue(option.waitForExistence(timeout: 30), "The API answered with no options")
    keepScreenshot("live-02-results")
    option.tap()
    XCTAssertTrue(element("itinerary-screen").waitForExistence(timeout: 10))
    keepScreenshot("live-03-trip")
  }
}
