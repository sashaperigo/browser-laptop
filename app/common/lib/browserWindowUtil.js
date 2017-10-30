/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let { screen, remote } = require('electron')
const { isDarwin } = require('./platformUtil.js')

// work with both in-process api and inter-process api
if (!screen && remote) {
  screen = remote.screen
}

/**
 * Determines the screen point for a window's client point
 */
function getScreenPointAtWindowClientPoint (browserWindow, clientPoint) {
  // TODO: include frame size calculation
  const [winX, winY] = browserWindow.getPosition()
  const x = Math.floor(winX + clientPoint.x)
  const y = Math.floor(winY + clientPoint.y)
  return { x, y }
}

function getWindowClientPointAtScreenPoint (browserWindow, screenPoint) {
  const [winX, winY] = browserWindow.getPosition()
  // TODO: include frame size calculation
  return {
    x: screenPoint.x - winX,
    y: screenPoint.y - winY
  }
}

function getWindowClientSize (browserWindow) {
  const [width, height] = browserWindow.getContentSize()
  return {
    width,
    height
  }
}

/**
 * Gets the window's client position of the mouse cursor
 */
function getWindowClientPointAtCursor (browserWindow) {
  return getWindowClientPointAtScreenPoint(browserWindow, screen.getCursorScreenPoint())
}

/**
 * Determines where a window should be positioned
 * given the requirement that a client position is
 * at a given screen position
 *
 * @param {*} screenPoint - the screen position
 * @param {*} clientPoint - the client position
 */
function getWindowPositionForClientPointAtScreenPoint (screenPoint, clientPoint) {
  // TODO: include frame size calculation
  const x = Math.floor(screenPoint.x - clientPoint.x)
  const y = Math.floor(screenPoint.y - clientPoint.y)
  return { x, y }
}

/**
 * Determines where a window should be positioned
 * given the requirement that a client position is
 * at the current cursor poisition
 *
 * @param {*} clientPoint - the client position
 */
function getWindowPositionForClientPointAtCursor (clientPoint) {
  return getWindowPositionForClientPointAtScreenPoint(screen.getCursorScreenPoint(), clientPoint)
}

function moveClientPositionToMouseCursor (browserWindow, clientX, clientY, {
  cursorScreenPoint = screen.getCursorScreenPoint(),
  animate = false
} = {}) {
  return moveClientPositionToScreenPoint(browserWindow, clientX, clientY, cursorScreenPoint.x, cursorScreenPoint.y, { animate })
}

function moveClientPositionToScreenPoint (browserWindow, clientX, clientY, screenX, screenY, { animate = false } = {}) {
  const screenPoint = getWindowPositionForClientPointAtScreenPoint({ x: screenX, screenY }, { x: clientX, clientY })
  browserWindow.setPosition(screenPoint.x, screenPoint.y, animate)
}

function animateWindowPosition (browserWindow, { fromPoint, getDestinationPoint }) {
  // electron widow position animation is darwin-only
  if (!isDarwin()) {
    moveWindowToDestination(browserWindow, getDestinationPoint)
  }
  browserWindow.setPosition(fromPoint.x, fromPoint.y)
  // just in case
  let attempts = 190
  const checkEveryMs = 16
  const moveWindow = () => {
    attempts--
    if (attempts === 0) {
      moveWindowToDestination(browserWindow, getDestinationPoint)
      return
    }
    if (browserWindow.isVisible()) {
      const [curX, curY] = browserWindow.getPosition()
      if (curX === fromPoint.x && curY === fromPoint.y) {
        moveWindowToDestination(browserWindow, getDestinationPoint, true)
      } else {
        setTimeout(moveWindow, checkEveryMs)
      }
    }
  }
  setTimeout(moveWindow, checkEveryMs)
}

function moveWindowToDestination (browserWindow, getDestinationPoint, animate = false) {
  const toPoint = getDestinationPoint()
  browserWindow.setPosition(toPoint.x, toPoint.y, animate)
}

module.exports = {
  getWindowClientPointAtCursor,
  getWindowClientPointAtScreenPoint,
  moveClientPositionToMouseCursor,
  animateWindowPosition,
  getWindowPositionForClientPointAtCursor,
  getScreenPointAtWindowClientPoint,
  getWindowClientSize
}
