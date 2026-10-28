import CoreLocation
import XCTest

// The main journeys, end to end, on a Release build in demo mode (no API address, so nothing is
// sent). Each test starts from "Delete all HopReady data", the same reset a person would use.
final class HopReadyJourneyTests: HopReadyTestCase {
  override func setUpWithError() throws {
    try super.setUpWithError()
    app.launch()
    deleteAllData()
    turnOnDemoMode()
  }

  func testPlanningADemoTripShowsOptionsAndTheTimeline() throws {
    planDriveAndParkTrip()

    let option = parkAndRideOption()
    XCTAssertTrue(option.waitForExistence(timeout: 30), "No drive and park option was offered")
    option.tap()

    XCTAssertTrue(element("itinerary-screen").waitForExistence(timeout: 10))
    XCTAssertTrue(element("leg-drive").exists, "The timeline has no drive leg")
    XCTAssertTrue(element("leg-park").exists, "The timeline has no parking step")
    XCTAssertTrue(app.buttons["I parked here"].exists)
    // The trip map is a native Apple map, with a spoken summary of the route laid over it.
    XCTAssertTrue(app.maps.firstMatch.waitForExistence(timeout: 10), "The trip map is missing")
    let summary = app.images.matching(NSPredicate(format: "label BEGINSWITH %@", "Map of the trip"))
    XCTAssertTrue(summary.firstMatch.exists, "The trip map has no spoken summary")

    // Start driving hands the drive to a navigation app. The simulator has only Apple Maps, so
    // HopReady opens it straight away.
    let startDriving = app.buttons.matching(
      NSPredicate(format: "label BEGINSWITH %@", "Start driving to")
    ).firstMatch
    scrollListTo(startDriving)
    startDriving.tap()
    let maps = XCUIApplication(bundleIdentifier: "com.apple.Maps")
    XCTAssertTrue(maps.wait(for: .runningForeground, timeout: 15), "Apple Maps did not open")
    app.activate()
  }

  // With location access allowed, the Plan tab's Current location fills in the start and the trip
  // plans from it. The simulated position is the demo world's Box Hill home.
  func testCurrentLocationStartsATripOnceAllowed() throws {
    XCUIDevice.shared.location = XCUILocation(
      location: CLLocation(latitude: -33.6431, longitude: 150.8975))
    openTab("Plan")
    tapWhenReady(element("quick-pick-current-location"))
    allowOrDenyLocation(allow: true)
    let origin = element("place-field-origin")
    expectation(for: NSPredicate(format: "label CONTAINS %@", "Current location"), evaluatedWith: origin)
    waitForExpectations(timeout: 15)

    tapWhenReady(element("place-field-destination"))
    chooseInPlaceSheet(search: "Chatswood")
    departAtMidMorning()
    tapWhenReady(element("plan-button"))
    XCTAssertTrue(parkAndRideOption().waitForExistence(timeout: 30), "No option from the current location")
  }

  func testParkedCarSurvivesARelaunchAndTakeMeHomeGoesThroughIt() throws {
    planDriveAndParkTrip()
    let option = parkAndRideOption()
    XCTAssertTrue(option.waitForExistence(timeout: 30))
    option.tap()

    tapWhenReady(app.buttons["I parked here"])
    XCTAssertTrue(element("confirm-parking").waitForExistence(timeout: 10))
    // The trip's car park is offered but never chosen for the person.
    let suggested = app.descendants(matching: .any).matching(
      NSPredicate(format: "label CONTAINS %@", "Suggested by your trip")
    ).firstMatch
    tapWhenReady(suggested)
    tapWhenReady(app.buttons["Save where I parked"])

    app.terminate()
    app.launch()
    openTab("Car")
    XCTAssertTrue(element("parked-car").waitForExistence(timeout: 10), "The parked car was lost")

    tapWhenReady(app.buttons["Take me home"])
    allowOrDenyLocation(allow: false)
    // Without location, HopReady asks where the trip starts, then where home is.
    chooseInPlaceSheet(search: "Chatswood")
    chooseInPlaceSheet(search: "Box Hill")

    XCTAssertTrue(element("results-screen").waitForExistence(timeout: 10))
    // Result cards are read as one sentence that starts with the kind of trip.
    let wayHome = app.buttons.matching(
      NSPredicate(format: "label BEGINSWITH %@", "Back via your car")
    ).firstMatch
    XCTAssertTrue(wayHome.waitForExistence(timeout: 30), "No way home through the car")
  }

  // Keeps a screenshot of each main screen in the result bundle, for review and for store
  // listing drafts (demo-mode captures carry the demo banner, so they are not for the store).
  func testCapturesTheMainScreens() throws {
    openTab("Plan")
    keepScreenshot("01-plan")
    // The search sheet has a floating header; the capture shows whether the field sits below it.
    tapWhenReady(element("place-field-origin"))
    XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 10))
    keepScreenshot("08-search")
    tapWhenReady(app.buttons["Cancel"])
    planDriveAndParkTrip()
    XCTAssertTrue(parkAndRideOption().waitForExistence(timeout: 30))
    keepScreenshot("02-results")
    tapWhenReady(app.buttons["Bigger map"])
    XCTAssertTrue(element("map-screen").waitForExistence(timeout: 10), "The full map did not open")
    keepScreenshot("09-map")
    tapWhenReady(app.buttons["Done"])
    parkAndRideOption().tap()
    XCTAssertTrue(element("itinerary-screen").waitForExistence(timeout: 10))
    keepScreenshot("03-trip")
    scrollPageDown()
    keepScreenshot("04-trip-steps")
    returnToTabs()
    openTab("Car")
    keepScreenshot("05-car")
    openTab("Saved")
    keepScreenshot("06-saved")
    openTab("Settings")
    keepScreenshot("07-settings")
  }
}
