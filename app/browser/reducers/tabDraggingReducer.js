/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const appConstants = require('../../../js/constants/appConstants')
const { BrowserWindow, screen } = require('electron')
const tabState = require('../../common/state/tabState')
const browserWindowUtil = require('../../common/lib/browserWindowUtil')
const { makeImmutable } = require('../../common/state/immutableUtil')
const {frameOptsFromFrame} = require('../../../js/state/frameStateUtil')
const tabs = require('../tabs')

const stateKey = 'tabDragData'

const reducer = (state, action, immutableAction) => {
  action = immutableAction || makeImmutable(action)
  switch (action.get('actionType')) {
    case appConstants.APP_TAB_DRAG_STARTED: {
      // calculate frame size based on difference
      // between where client reports a screen coordinate is
      // and where we think a screen coordinate would be
      const dragSourceData = action.get('dragSourceData')
      const sourceWindowId = dragSourceData.get('originalWindowId')
      const clientX = dragSourceData.get('originClientX')
      const clientY = dragSourceData.get('originClientY')
      const screenX = dragSourceData.get('originScreenX')
      const screenY = dragSourceData.get('originScreenY')
      const [winX, winY] = BrowserWindow.fromId(sourceWindowId).getPosition()
      const frameTopHeight = screenY - clientY - winY
      const frameLeftWidth = screenX - clientX - winX
      // replace state data
      state = state.set(stateKey, dragSourceData.merge({
        frameTopHeight,
        frameLeftWidth
      }))
      break
    }
    case appConstants.APP_TAB_DRAG_CANCELLED: {
      // return to original position, original window
      // delete state data
      state = state.delete(stateKey)
      break
    }
    case appConstants.APP_TAB_DRAG_COMPLETE: {
      // delete state data
      // TODO: clean up original window we kept around
      state = state.delete(stateKey)
      break
    }
    case appConstants.APP_TAB_DRAG_CHANGE_DISPLAY_INDEX: {
      const sourceTabId = state.getIn([stateKey, 'sourceTabId'])
      const destinationIndex = action.get('destinationIndex')
      state = state.mergeIn([stateKey], {
        // cache what we're doing, so we don't repeat request to move tab
        // since it may take longer than it takes to fire mousemove multiple times
        displayIndexRequested: destinationIndex
      })
      process.stdout.write('POS-')
      setImmediate(() => {
        process.stdout.write('.')
        tabs.setTabIndex(sourceTabId, destinationIndex)
      })
      break
    }
    case appConstants.APP_WINDOW_READY: {
      const dragSourceData = state.get(stateKey)

      if (!dragSourceData) {
        break
      }
      if (dragSourceData.has('detachRequestedWindowId')) {
        const windowId = action.get('windowId')
        const detachedFromWindowId = dragSourceData.get('detachRequestedWindowId')
        // check to see if tab is attached to that window yet
        if (windowId === detachedFromWindowId) {
          // weird, a window was created that was the one we're detaching from?!
          break
        }
        process.stdout.write(`DD-${windowId}`)
        // can continue processing mousemove events
        state = state.deleteIn([stateKey, 'detachRequestedWindowId'])
        state = state.deleteIn([stateKey, 'displayIndexRequested'])
        state = state.setIn([stateKey, 'currentWindowId'], windowId)
        setImmediate(() => {
          // move the window so the tab is under the mouse cursor
          const win = BrowserWindow.fromId(windowId)
          win.focus()
          const relativeTabX = dragSourceData.get('relativeXDragStart')
          const relativeClientY = dragSourceData.get('originClientY')
          // but first position it where it detached from, so we can animate there
          const detachedWindow = BrowserWindow.fromId(detachedFromWindowId)
          const originalTabScreenPosition = browserWindowUtil.getScreenPointAtWindowClientPoint(detachedWindow, {
            x: dragSourceData.get('detachedFromTabX') - relativeTabX,
            y: dragSourceData.get('detachedFromTabY')
          })
          browserWindowUtil.animateWindowPosition(win, {
            fromPoint: originalTabScreenPosition,
            // TODO include original tab parent bounds and assume new window will have tab group at same pos
            // (pinned tabs?)
            getDestinationPoint: () => browserWindowUtil.getWindowPositionForClientPointAtCursor({
              x: relativeTabX,
              y: relativeClientY
            })
          })
        })
      }
      break
    }
    case appConstants.APP_WINDOW_CREATED: {
      break
    }
    case appConstants.APP_TAB_ATTACHED: {
      const dragSourceData = state.get(stateKey)
      if (!dragSourceData) {
        break
      }
      const sourceTabId = dragSourceData.get('sourceTabId')
      if (dragSourceData.has('attachRequestedWindowId')) {
        // check to see if tab is attached to that window yet
        const currentWindowId = tabState.getWindowId(state, sourceTabId)
        if (currentWindowId !== dragSourceData.get('attachRequestedWindowId')) {
          process.stdout.write('WA-')
          // don't do anything if still waiting for tab attach
          break
        }
        process.stdout.write(`DA-${currentWindowId}`)
        // can continue processing drag mouse move events
        state = state.deleteIn([stateKey, 'attachRequestedWindowId'])
        state = state.deleteIn([stateKey, 'displayIndexRequested'])
        // give the renderer some location information as the mouse may not have moved since attach
        // it can manually drag the tab to where the mouse is, making any display index changes required
        const win = BrowserWindow.fromId(currentWindowId)
        const cursorWindowPoint = browserWindowUtil.getWindowClientPointAtCursor(win)
        state = state.mergeIn([stateKey], {
          currentWindowId,
          dragWindowClientX: cursorWindowPoint.x,
          dragWindowClientY: cursorWindowPoint.y
        })
      }
      break
    }
    case appConstants.APP_TAB_DRAG_SINGLE_TAB_MOVED: {
      const yThreshold = 50
      const dragSourceData = state.get(stateKey)
      if (!dragSourceData) {
        // can get here because store somehow received the 'moved' action
        // before it receives the 'started' action
        break
      }
      const sourceTabId = dragSourceData.get('sourceTabId')
      const currentWindowId = dragSourceData.get('currentWindowId')
      // wait for any pending attach
      if (dragSourceData.has('attachRequestedWindowId')) {
        break
      }
      // wait for any pending detach
      if (dragSourceData.has('detachRequestedWindowId')) {
        break
        // window created event will fire, which will handle clearing this block
      }
      // even though new window has been created, it may not actuall be attached to the window we think it is
      const actualWindowId = tabState.getWindowId(state, sourceTabId)
      if (currentWindowId !== actualWindowId) {
        process.stdout.write(`WW-${currentWindowId}-${actualWindowId}`)
        break
      }
      // might get leftover calls from old windows just after detach
      const eventSourceWindowId = action.get('windowId')
      if (currentWindowId !== eventSourceWindowId) {
        process.stdout.write(`BTM-${currentWindowId}-${eventSourceWindowId}`)
        break
      }
      // find when to attach this tab to another window
      // we need all window positions
      // see if we're within each browsers X + width Y + relativeY +/- threshold
      const allWindows = BrowserWindow.getAllWindows()
      const currentTabWindow = BrowserWindow.fromId(currentWindowId)
      const otherWindows = allWindows.filter(win => win !== currentTabWindow)
      const clientTabY = action.get('tabY')
      // TODO: filter windows which are covered by other windows
      // and so are not visible to the user
      const mouseScreenPos = screen.getCursorScreenPoint()
      const intersectionWindow = otherWindows.find(win => {
        const windowCursorClientPosition = browserWindowUtil.getWindowClientPointAtScreenPoint(win, mouseScreenPos)
        const winClientWidth = browserWindowUtil.getWindowClientSize(win).width
        if (
          windowCursorClientPosition.x > 0 &&
          windowCursorClientPosition.x < winClientWidth &&
          windowCursorClientPosition.y < clientTabY + (yThreshold / 2) &&
          windowCursorClientPosition.y > clientTabY - (yThreshold / 2)
        ) {
          return true
        }
      })
      if (intersectionWindow) {
        // found window should attach to
        const frameOpts = frameOptsFromFrame(dragSourceData.get('frame'))
        // remember the window we're waiting to attach to
        // also send that window's tab component the mouse position as it may
        // not receive a mousemove event after it sets it up (user mouse may be paused until
        // tab 'looks' attached)
        const cursorWindowPoint = browserWindowUtil.getWindowClientPointAtCursor(intersectionWindow, mouseScreenPos)
        state = state.mergeIn([stateKey], {
          dragWindowClientX: cursorWindowPoint.x,
          dragWindowClientY: cursorWindowPoint.y,
          attachRequestedWindowId: intersectionWindow.id
        })
        process.stdout.write(`A-${intersectionWindow.id}`)
        // TODO: windows which only have one tab will be
        // destroyed as soon as we attached that tab to another
        // window. And the original window the tab was in
        // is required to keep the drag event happening.
        // Until we support keeping that window hanging around, we'll
        // have to end the drag event now
        if (dragSourceData.get('originatedFromSingleTabWindow')) {
          // end the drag operation
          state = state.delete(stateKey)
        }
        // attach
        setImmediate(() => {
          process.stdout.write('|')
          intersectionWindow.focus()
          tabs.moveTo(state, sourceTabId, frameOpts, {}, intersectionWindow.id)
        })
      } else {
        setImmediate(() => {
          process.stdout.write('M-')
          // only tab, move the position by delta
          const win = BrowserWindow.fromId(currentWindowId)
          const relativeTabX = dragSourceData.get('relativeXDragStart')
          const relativeTabY = dragSourceData.get('relativeYDragStart')
          const tabX = action.get('tabX')
          const tabY = action.get('tabY')
          const frameLeftWidth = dragSourceData.get('frameLeftWidth')
          const frameTopHeight = dragSourceData.get('frameTopHeight')
          const windowY = Math.floor(mouseScreenPos.y - tabY - frameTopHeight - relativeTabY)
          const windowX = Math.floor(mouseScreenPos.x - tabX - frameLeftWidth - relativeTabX)
          win.setPosition(windowX, windowY)
        })
      }
      break
    }
    case appConstants.APP_TAB_DRAG_DETACH_REQUESTED: {
      const dragSourceData = state.get(stateKey)
      if (!dragSourceData) {
        break
      }
      const sourceTabId = dragSourceData.get('sourceTabId')
      const currentWindowId = tabState.getWindowId(state, sourceTabId)
      setImmediate(() => {
        process.stdout.write('D-')
        const browserOpts = {
          checkMaximized: false
        }
        const frameOpts = frameOptsFromFrame(dragSourceData.get('frame'))
        tabs.moveTo(state, sourceTabId, frameOpts, browserOpts, -1)
      })
      // remember that we have asked for a new window,
      // so that we do not try to create again
      state = state.mergeIn([stateKey], {
        detachRequestedWindowId: currentWindowId,
        detachedFromTabX: action.get('tabX'),
        detachedFromTabY: action.get('tabY')
      })

      break
    }
  }
  return state
}

module.exports = reducer
