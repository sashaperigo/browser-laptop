/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this file,
* You can obtain one at http://mozilla.org/MPL/2.0/. */

const React = require('react')
const {StyleSheet, css} = require('aphrodite/no-important')

// Components
const ReduxComponent = require('../reduxComponent')
const Favicon = require('./content/favIcon')
const AudioTabIcon = require('./content/audioTabIcon')
const NewSessionIcon = require('./content/newSessionIcon')
const PrivateIcon = require('./content/privateIcon')
const TabTitle = require('./content/tabTitle')
const CloseTabIcon = require('./content/closeTabIcon')
const {NotificationBarCaret} = require('../main/notificationBar')
var electron = require('electron')

// Actions
const appActions = require('../../../../js/actions/appActions')
const windowActions = require('../../../../js/actions/windowActions')

// Store
const windowStore = require('../../../../js/stores/windowStore')

// State helpers
const privateState = require('../../../common/state/tabContentState/privateState')
const audioState = require('../../../common/state/tabContentState/audioState')
const tabUIState = require('../../../common/state/tabUIState')
const tabState = require('../../../common/state/tabState')

// Styles
const globalStyles = require('../styles/global')
const {theme} = require('../styles/theme')

// Utils
const cx = require('../../../../js/lib/classSet')
const {getTextColorForBackground} = require('../../../../js/lib/color')
const contextMenus = require('../../../../js/contextMenus')
const frameStateUtil = require('../../../../js/state/frameStateUtil')
const {hasTabAsRelatedTarget} = require('../../lib/tabUtil')
const isWindows = require('../../../common/lib/platformUtil').isWindows()
const browserWindowUtil = require('../../../common/lib/browserWindowUtil')
const {getCurrentWindowId} = require('../../currentWindow')
const {setObserver} = require('../../lib/observerUtil')
const UrlUtil = require('../../../../js/lib/urlutil')
const throttle = require('lodash.throttle')

const DRAG_DETACH_PX_THRESHOLD_INITIAL = 44
const DRAG_DETACH_PX_THRESHOLD_POSTSORT = 80
const DRAG_DETACH_MS_TIME_BUFFER = 0

// HACK mousemove will only trigger in the other window if the coords are inside the bounds but
// will trigger for this window even if the mouse is outside the window, since we started a dragEvent,
// *but* it will forward anything for globalX and globalY, so we'll send the client coords in those properties
// and send some fake coords in the clientX and clientY properties
// An alternative solution would be for the other window to just call electron API
// to get mouse cursor, and we could just send 0, 0 coords, but this reduces the spread of electron
// calls in components, and also puts the (tiny) computation in another process, freeing the other
// window to perform the animation
function createEventForSendMouseMoveInput (screenX, screenY) {
  return {
    type: 'mousemove',
    x: 1,
    y: 99,
    globalX: screenX,
    globalY: screenY
  }
}

function translateEventFromSendMouseMoveInput (receivedEvent) {
  return (receivedEvent.x === 1 && receivedEvent.y === 99)
    ? { clientX: receivedEvent.screenX, clientY: receivedEvent.screenY }
    : receivedEvent
}

class Tab extends React.Component {
  constructor (props) {
    super(props)
    this.onMouseMove = this.onMouseMove.bind(this)
    this.onMouseEnter = this.onMouseEnter.bind(this)
    this.onMouseLeave = this.onMouseLeave.bind(this)
    this.onDragStart = this.onDragStart.bind(this)
    this.onClickTab = this.onClickTab.bind(this)
    this.onObserve = this.onObserve.bind(this)
    this.onTabDraggingMouseMove = this.onTabDraggingMouseMove.bind(this)
    this.onTabClosedWithMouse = this.onTabClosedWithMouse.bind(this)
    this.onTabDraggingMouseMoveDetectSortChangeThrottled = throttle(this.onTabDraggingMouseMoveDetectSortChange.bind(this), 10)
    this.tabNode = null
  }

  get frame () {
    return windowStore.getFrame(this.props.frameKey)
  }

  //
  // Events to dispatch drag operations to store.
  // Only run by source window
  //

  /// Setup this tab window instance as the dragging source
  /// moving the tab and orchestrating order changes
  /// as well as dispatching events to the store so it can
  /// handle detach / attach
  /// Because this drag event starts in this window's web context,
  /// it will receive locations even outside of the window.
  /// If we start monitoring mousemove events in another window, it wouldn't
  /// get position updates when the mouse moves outside the window, which we need
  /// so we use the event instances started from this window to control the movement
  /// in any other window the tab may have been dragged to
  onDragStart (e) {
    e.preventDefault()
    const dragElementBounds = e.target.getBoundingClientRect()
    // let the store know where on the tab the mouse is, so it can always
    // keep the tab in the same place under the mouse, regardless of which
    // actual element from which window is being moved
    const relativeXDragStart = e.clientX - dragElementBounds.left
    const relativeYDragStart = e.clientY - dragElementBounds.top
    appActions.tabDragStarted(
      getCurrentWindowId(),
      this.frame,
      this.props.tabId,
      e.clientX,
      e.clientY,
      e.screenX,
      e.screenY,
      dragElementBounds.width,
      dragElementBounds.height,
      relativeXDragStart,
      relativeYDragStart,
      this.props.singleTab
    )
    this.setupDragContinueEvents()

    if (this.frame) {
      // cancel tab preview while dragging. see #10103
      windowActions.setTabHoverState(this.props.frameKey, false, false)
    }
  }

  /// For when this tab / window is the dragging source
  /// dispatch the events to the store so that the
  /// other windows can receive state update of where to put the tab
  setupDragContinueEvents () {
    const stopDragListeningEvents = () => {
      window.removeEventListener('mouseup', onTabDragComplete)
      window.removeEventListener('keydown', onTabDragCancel)
      window.removeEventListener('mousemove', onTabDragMove)
    }
    const onTabDragComplete = e => {
      stopDragListeningEvents()
      appActions.tabDragComplete()
    }
    const onTabDragCancel = e => {
      if (e.keyCode === 27) { // ESC key
        stopDragListeningEvents()
        appActions.tabDragCancelled()
      }
    }

    const onTabDragMove = mouseMoveEvent => {
      mouseMoveEvent.preventDefault()
      reportMoveToOtherWindow(mouseMoveEvent)
    }
    const reportMoveToOtherWindow = throttle(this.reportMoveToOtherWindow.bind(this), 4)
    window.addEventListener('mouseup', onTabDragComplete)
    window.addEventListener('keydown', onTabDragCancel)
    window.addEventListener('mousemove', onTabDragMove)
  }

  /// HACK Even if the other window is 'active', it will not receive regular mousemove events
  /// ...probably because there is another mousemove event in progress generated from another
  /// window.
  /// So send the mouse events using muon's BrowserWindow.sendInputEvent
  /// This was previously done in the browser process as a result of the 'dragMoved' store action
  /// but it was never smooth enough, even when reducing the throttle time
  reportMoveToOtherWindow (mouseMoveEvent) {
    // HACK we cannot get the new window ID (tabDragData.currentWindowId) from the store state
    // when we are dragged to another window since our component will
    // not be subscribed to store updates anymore as technically it
    // does not exist, so...
    // ...get the currently focused window... if this is flakey we could subscribe to the store
    // manually (and probably create another higher order component for all this to preserve sanity)
    const win = electron.remote.BrowserWindow.getActiveWindow()
    if (!win || win.id === getCurrentWindowId()) {
      return
    }
    const {x: clientX, y: clientY} = browserWindowUtil.getWindowClientPointAtCursor(win, {
      x: mouseMoveEvent.screenX,
      y: mouseMoveEvent.screenY
    })
    win.webContents.sendInputEvent(createEventForSendMouseMoveInput(clientX, clientY))
  }

  //
  // Events for drag-sort amongst this tab group
  // Run by any window that receives a dragged tab
  //

  attachDragSortHandlers () {
    // get tab width
    this.draggingTabWidth = this.elementRef.getBoundingClientRect().width
    // initial distance that has to be travelled outside the tab bar in order to detach the tab
    // (increases after some sorting has happened, as the user may be more 'relaxed' with the mouse)
    this.draggingDetachThreshold = DRAG_DETACH_PX_THRESHOLD_INITIAL
    // save parent position in order to know where first-tab position is, and also the bounds for detaching
    // this is cached and re-evaluated whenever the drag operation starts (or is attached to a different window)
    // if, for some reason, the parent position can change during a drag operation, then this should be re-evaluated
    // more often
    this.parentClientRect = this.elementRef.parentElement.getBoundingClientRect()
    window.addEventListener('mousemove', this.onTabDraggingMouseMove)
  }

  removeDragSortHandlers () {
    this.draggingTabWidth = null
    this.parentClientRect = null
    this.singleTabPosition = null
    this.currentWindowId = null
    window.removeEventListener('mousemove', this.onTabDraggingMouseMove)
    if (this.draggingDetachTimeout) {
      window.clearTimeout(this.draggingDetachTimeout)
      this.draggingDetachThreshold = null
    }
    this.tabFinishedDragging()
  }

  onTabDraggingMouseMove (e) {
    e = translateEventFromSendMouseMoveInput(e)
    if (this.props.dragProcessMoves) {
      if (!this.props.dragSingleTab) {
        // don't continue if we're about to detach
        // we'll soon get the props change to remove mouse event listeners
        if (!this.hasRequestedDetach) {
          // move tab with mouse (rAF - smooth)
          this.dragTabMouseMoveFrame = this.dragTabMouseMoveFrame || window.requestAnimationFrame(this.dragTab.bind(this, e))
          // change order of tabs when passed boundaries (debounced - helps being smooth)
          this.onTabDraggingMouseMoveDetectSortChangeThrottled(e)
        }
      } else {
        this.onTabDraggingMoveSingleTabWindow(e)
      }
    }
  }

  onTabDraggingMouseMoveDetectSortChange (e) {
    if (!this.parentClientRect) {
      return
    }
    // find when the order should be changed
    // but don't if we already have requested it,
    // wait until the order changes
    if (!this.props.draggingDisplayIndexRequested || this.props.draggingDisplayIndexRequested === this.props.displayIndex) {
      // detach threshold is a time thing
      // If it's been outside of the bounds for X time, then we can detach
      const isOutsideBounds =
        e.clientX < this.parentClientRect.x - this.draggingDetachThreshold ||
        e.clientX > this.parentClientRect.x + this.parentClientRect.width + this.draggingDetachThreshold ||
        e.clientY < this.parentClientRect.y - this.draggingDetachThreshold ||
        e.clientY > this.parentClientRect.y + this.parentClientRect.height + this.draggingDetachThreshold
      if (isOutsideBounds) {
        // start a timeout to see if we're still outside, don't restart if we already started one
        this.draggingDetachTimeout = this.draggingDetachTimeout || window.setTimeout(() => {
          appActions.tabDragDetachRequested(e.clientX, this.parentClientRect.top)
        }, DRAG_DETACH_MS_TIME_BUFFER)
      } else {
        // we're not outside, so reset the timer
        if (this.draggingDetachTimeout) {
          window.clearTimeout(this.draggingDetachTimeout)
          this.draggingDetachTimeout = null
        }
      }
      // assumes all tabs in this group have same width
      const tabWidth = this.draggingTabWidth
      const tabLeft = e.clientX - this.parentClientRect.left - this.props.relativeXDragStart
      const currentIndex = this.props.displayIndex
      const destinationIndex = Math.max(
        0,
        Math.min(this.props.displayedTabCount - 1, Math.floor((tabLeft + (tabWidth / 2)) / tabWidth))
      )
      if (currentIndex !== destinationIndex) {
        appActions.tabDragChangeDisplayIndex(destinationIndex)
        // now that we have sorted, increase the threshold
        // required for detach
        this.draggingDetachThreshold = DRAG_DETACH_PX_THRESHOLD_POSTSORT
      }
    }
  }

  dragTab (e) {
    if (!this.elementRef) {
      return
    }
    // cache just in case we need to force the tab to move to the mouse cursor
    // without a mousemove event
    this.currentMouseX = e.clientX
    this.dragTabMouseMoveFrame = null
    const relativeLeft = this.props.relativeXDragStart
    const currentX = this.elementRef.offsetLeft
    const deltaX = e.clientX - currentX - relativeLeft
    this.elementRef.style.setProperty('--dragging-delta-x', deltaX + 'px')
  }

  tabFinishedDragging () {
    // move tab back to it's actual position, from the mouse position
    if (this.elementRef) {
      window.requestAnimationFrame(() => {
        // need to check if element is still around
        if (!this.elementRef) {
          return
        }
        const lastPos = this.elementRef.style.getPropertyValue('--dragging-delta-x')
        if (lastPos !== '') { // default for a property not set is empty string
          this.elementRef.style.removeProperty('--dragging-delta-x')
          this.elementRef.animate([{
            transform: `translateX(${lastPos})`
          }, {
            transform: 'translateX(0)'
          }], {
            duration: 240,
            easing: 'cubic-bezier(0.23, 1, 0.32, 1)'
          })
        }
      })
    }
  }

  onTabDraggingMoveSingleTabWindow (e) {
    if (!this.elementRef) {
      return
    }
    // send the store the location of the tab to the window
    // so that it can calculate where to move the window
    // cached
    const { x, y } = this.singleTabPosition = this.singleTabPosition || this.elementRef.getBoundingClientRect()
    this.currentWindowId = this.currentWindowId || getCurrentWindowId()
    // we do not need to send the cursor pos as it will be read by the store, since
    // it may move between here and there
    appActions.tabDragSingleTabMoved(x, y, this.currentWindowId)
  }

  //
  // General Events
  //

  onMouseLeave (e) {
    // mouseleave will keep the previewMode
    // as long as the related target is another tab
    windowActions.setTabHoverState(this.props.frameKey, false, hasTabAsRelatedTarget(e))
  }

  onMouseEnter (e) {
    // if mouse entered a tab we only trigger a new preview
    // if user is in previewMode, which is defined by mouse move
    windowActions.setTabHoverState(this.props.frameKey, true, this.props.previewMode)
  }

  onMouseMove () {
    // dispatch a message to the store so it can delay
    // and preview the tab based on mouse idle time
    windowActions.onTabMouseMove(this.props.frameKey)
  }

  onAuxClick (e) {
    this.onClickTab(e)
  }

  onTabClosedWithMouse (event) {
    event.stopPropagation()
    const frame = this.frame

    if (frame && !frame.isEmpty()) {
      const tabWidth = this.fixTabWidth
      windowActions.onTabClosedWithMouse({
        fixTabWidth: tabWidth
      })
      appActions.tabCloseRequested(this.props.tabId)
    }
  }

  onClickTab (e) {
    switch (e.button) {
      case 2:
        // Ignore right click
        return
      case 1:
        // Close tab with middle click
        this.onTabClosedWithMouse(e)
        break
      default:
        e.stopPropagation()
        appActions.tabActivateRequested(this.props.tabId)
    }
  }

  onObserve (entries) {
    if (this.props.isPinnedTab) {
      return
    }
    // we only have one entry
    const entry = entries[0]
    windowActions.setTabIntersectionState(this.props.frameKey, entry.intersectionRatio)
  }

  get fixTabWidth () {
    if (!this.tabNode) {
      return 0
    }

    const rect = this.elementRef.getBoundingClientRect()
    return rect && rect.width
  }

  //
  // React lifecycle events
  //

  componentDidMount () {
    // unobserve tabs that we don't need. This will
    // likely be made by onObserve method but added again as
    // just to double-check
    if (this.props.isPinned) {
      this.observer && this.observer.unobserve(this.tabSentinel)
    }
    const threshold = Object.values(globalStyles.intersection)
    // At this moment Chrome can't handle unitless zeroes for rootMargin
    // see https://github.com/w3c/IntersectionObserver/issues/244
    const margin = '0px'
    this.observer = setObserver(this.tabSentinel, threshold, margin, this.onObserve)
    this.observer.observe(this.tabSentinel)

    this.tabNode.addEventListener('auxclick', this.onAuxClick.bind(this))

    // if a new tab is already dragging,
    // that means that it has been attached from another window.
    // That window is handling the mousemove -> store dispatch
    // which is sending our window mousemove events.
    // All we have to do is move the tab DOM element,
    // and let the store know when the tab should move to another
    // tab's position
    if (this.props.isDragging && !this.props.dragOriginatedThisWindow) {
        // setup tab moving
      this.attachDragSortHandlers()
    }
  }

  componentWillUnmount () {
    this.observer.unobserve(this.tabSentinel)
    // tear-down tab moving if still setup
    if (this.props.isDragging) {
      this.removeDragSortHandlers()
    }
  }

  mergeProps (state, ownProps) {
    const currentWindow = state.get('currentWindow')
    const frame = ownProps.frame
    const frameKey = frame.get('key')
    const tabId = frame.get('tabId', tabState.TAB_ID_NONE)
    const isPinned = tabState.isTabPinned(state, tabId)
    const partOfFullPageSet = ownProps.partOfFullPageSet

    // TODO: this should have its own method
    const notifications = state.get('notifications')
    const notificationOrigins = notifications ? notifications.map(bar => bar.get('frameOrigin')) : false
    const notificationBarActive = frame.get('location') && notificationOrigins &&
      notificationOrigins.includes(UrlUtil.getUrlOrigin(frame.get('location')))

    const props = {}
    // TODO: this should have its own method
    props.notificationBarActive = notificationBarActive
    props.frameKey = frameKey
    props.isEmpty = frame.isEmpty()
    props.isPinnedTab = isPinned
    props.isPrivateTab = privateState.isPrivateTab(currentWindow, frameKey)
    props.isActive = frameStateUtil.isFrameKeyActive(currentWindow, frameKey)
    props.tabWidth = currentWindow.getIn(['ui', 'tabs', 'fixTabWidth'])
    props.themeColor = tabUIState.getThemeColor(currentWindow, frameKey)
    props.displayIndex = ownProps.displayIndex
    props.displayedTabCount = ownProps.displayedTabCount
    props.title = frame.get('title')
    props.partOfFullPageSet = partOfFullPageSet
    props.showAudioTopBorder = audioState.showAudioTopBorder(currentWindow, frameKey, isPinned)
    props.centralizeTabIcons = tabUIState.centralizeTabIcons(currentWindow, frameKey, isPinned)

    // used in other functions
    props.tabId = tabId
    props.previewMode = currentWindow.getIn(['ui', 'tabs', 'previewMode'])

    // drag related
    const dragSourceData = state.get('tabDragData')
    props.dragIntendedWindowId = dragSourceData ? dragSourceData.get('currentWindowId') : null
    // needs to know if window will be destroyed when tab is detached
    props.singleTab = ownProps.singleTab
    const windowId = getCurrentWindowId()
    if (
      dragSourceData &&
      tabState.isTabDragging(state, tabId) &&
      tabState.getWindowId(state, tabId) === windowId
    ) {
      // make sure we're setup
      props.isDragging = true
      props.dragOriginatedThisWindow = dragSourceData.get('originalWindowId') === windowId
      props.draggingDisplayIndexRequested = dragSourceData.get('displayIndexRequested')
      props.dragSingleTab = ownProps.singleTab
      props.dragProcessMoves =
        !dragSourceData.has('attachRequestedWindowId') &&
        !dragSourceData.has('detachRequestedWindowId') &&
        props.dragIntendedWindowId === windowId
      props.relativeXDragStart = dragSourceData.get('relativeXDragStart')
      props.dragWindowClientX = dragSourceData.get('dragWindowClientX')
      props.dragWindowClientY = dragSourceData.get('dragWindowClientY')
    } else {
      props.isDragging = false
      props.relativeXDragStart = null
      props.draggingDisplayIndexRequested = null
      props.dragOriginatedThisWindow = false
      props.dragProcessMoves = false
    }
    return props
  }

  componentWillReceiveProps (nextProps) {
    if (this.props.tabWidth && !nextProps.tabWidth) {
      // remember the width so we can transition from it
      this.originalWidth = this.elementRef.getBoundingClientRect().width
    }
  }

  componentDidUpdate (prevProps) {
    if (!this.elementRef) {
      return
    }
    // animate tab width if it changes due to a
    // removal of a restriction when performing
    // multiple tab-closes in a row
    if (prevProps.tabWidth && !this.props.tabWidth) {
      window.requestAnimationFrame(() => {
        const newWidth = this.elementRef.getBoundingClientRect().width
        this.elementRef.animate([
          { flexBasis: `${this.originalWidth}px`, flexGrow: 0, flexShrink: 0 },
          { flexBasis: `${newWidth}px`, flexGrow: 0, flexShrink: 0 }
        ], {
          duration: 250,
          iterations: 1,
          easing: 'ease-in-out'
        })
      })
    }

    if (this.props.isDragging && !prevProps.isDragging) {
      // setup event to move tab DOM element along with
      // mousemove and let the store know when it should
      // move the sort position of the tab.
      // A different process (different because the window the tab is in may change)
      // is firing the event to the store which will check
      // for detach / attach to windows
      this.attachDragSortHandlers()
      // fire sort handler manually with the first update, if we have one
      // since we may have attached but not received mouse event yet
      if (this.props.dragWindowClientX && this.props.dragWindowClientY) {
        this.onTabDraggingMouseMove({ clientX: this.props.dragWindowClientX, clientY: this.props.dragWindowClientY })
      }
    } else if (prevProps.isDragging && !this.props.isDragging) {
      // tear-down tab moving
      this.removeDragSortHandlers()
    }

    // detect sort order change during drag
    if (
      this.props.dragProcessMoves && this.currentMouseX != null &&
      this.props.displayIndex !== prevProps.displayIndex
    ) {
      this.dragTab({ clientX: this.currentMouseX })
    }
  }

  render () {
    // we don't want themeColor if tab is private
    const isThemed = !this.props.isPrivateTab && this.props.isActive && this.props.themeColor
    const instanceStyles = { }
    if (isThemed) {
      instanceStyles['--theme-color-fg'] = getTextColorForBackground(this.props.themeColor)
      instanceStyles['--theme-color-bg'] = this.props.themeColor
    }
    return <div
      data-tab-area
      className={cx({
        tabArea: true,
        isDragging: this.props.isDragging,
        isPinned: this.props.isPinnedTab,
        isActive: this.props.isActive,
        partOfFullPageSet: this.props.partOfFullPageSet || !!this.props.tabWidth
      })}
      style={this.props.tabWidth && !this.props.isPinnedTab ? { flex: `0 0 ${this.props.tabWidth}px` } : {}}
      onMouseMove={this.onMouseMove}
      onMouseEnter={this.onMouseEnter}
      onMouseLeave={this.onMouseLeave}
      data-test-id='tab-area'
      data-frame-key={this.props.frameKey}
      ref={elementRef => { this.elementRef = elementRef }}
      >
      {
        this.props.isActive && this.props.notificationBarActive
          ? <NotificationBarCaret />
          : null
      }
      <div
        data-tab
        ref={(node) => { this.tabNode = node }}
        className={css(
          styles.tab,
          // Windows specific style
          isWindows && styles.tab_forWindows,
          this.props.isPinnedTab && styles.tab_pinned,
          this.props.isActive && styles.tab_active,
          this.props.showAudioTopBorder && styles.tab_audioTopBorder,
          // Private color should override themeColor
          this.props.isPrivateTab && styles.tab_private,
          this.props.isActive && this.props.isPrivateTab && styles.tab_active_private,
          this.props.isEmpty && styles.tab_empty,
          this.props.centralizeTabIcons && styles.tab__content_centered,
          isThemed && styles.tab_themed
        )}
        style={instanceStyles}
        data-test-id='tab'
        data-test-active-tab={this.props.isActive}
        data-test-pinned-tab={this.props.isPinnedTab}
        data-test-private-tab={this.props.isPrivateTab}
        data-frame-key={this.props.frameKey}
        draggable
        title={this.props.title}
        onDragStart={this.onDragStart}
        onClick={this.onClickTab}
        onContextMenu={contextMenus.onTabContextMenu.bind(this, this.frame)}
      >
        <div
          ref={(node) => { this.tabSentinel = node }}
          className={css(styles.tab__sentinel)}
        />
        <div className={css(
          styles.tab__identity,
          this.props.centralizeTabIcons && styles.tab__content_centered
        )}>
          <Favicon tabId={this.props.tabId} />
          <AudioTabIcon tabId={this.props.tabId} />
          <TabTitle tabId={this.props.tabId} />
        </div>
        <PrivateIcon tabId={this.props.tabId} />
        <NewSessionIcon tabId={this.props.tabId} />
        <CloseTabIcon tabId={this.props.tabId} onClick={this.onTabClosedWithMouse} />
      </div>
    </div>
  }
}

const styles = StyleSheet.create({
  tab: {
    boxSizing: 'border-box',
    color: theme.tab.color,
    display: 'flex',
    transition: theme.tab.transition,
    height: '100%',
    width: '-webkit-fill-available',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',

    ':hover': {
      background: theme.tab.hover.background
    }
  },

  tab_isDragging: {

  },

  // Windows specific style
  tab_forWindows: {
    color: theme.tab.forWindows.color
  },

  tab_pinned: {
    padding: 0,
    width: '28px',
    justifyContent: 'center'
  },

  tab_active: {
    background: theme.tab.active.background,
    paddingBottom: '1px',
    ':hover': {
      background: theme.tab.active.background
    }
  },

  tab_audioTopBorder: {
    '::before': {
      zIndex: globalStyles.zindex.zindexTabsAudioTopBorder,
      content: `''`,
      display: 'block',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '2px',
      background: 'lightskyblue'
    }
  },

  tab_empty: {
    background: 'white'
  },

  // The sentinel is responsible to respond to tabs
  // intersection state. This is an empty hidden element
  // which `width` value shouldn't be changed unless the intersection
  // point needs to be edited.
  tab__sentinel: {
    position: 'absolute',
    left: 0,
    height: '1px',
    background: 'transparent',
    width: globalStyles.spacing.sentinelSize
  },

  tab__identity: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    minWidth: '0', // @see https://bugzilla.mozilla.org/show_bug.cgi?id=1108514#c5
    margin: `0 ${globalStyles.spacing.defaultTabMargin}`
  },

  tab__content_centered: {
    justifyContent: 'center',
    flex: 'auto',
    padding: 0,
    margin: 0
  },

  tab_active_private: {
    background: theme.tab.active.private.background,
    color: theme.tab.active.private.color,

    ':hover': {
      background: theme.tab.active.private.background
    }
  },

  tab_private: {
    background: theme.tab.private.background,

    ':hover': {
      color: theme.tab.active.private.color,
      background: theme.tab.active.private.background
    }
  },

  tab_themed: {
    color: `var(--theme-color-fg, inherit)`,
    background: `var(--theme-color-bg, inherit)`,

    ':hover': {
      color: `var(--theme-color-fg, inherit)`,
      background: `var(--theme-color-bg, inherit)`
    }
  }

})

module.exports = ReduxComponent.connect(Tab)
