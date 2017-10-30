/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const React = require('react')
const Immutable = require('immutable')

// Components
const ReduxComponent = require('../reduxComponent')
const LongPressButton = require('../common/longPressButton')
const Tab = require('./tab')
const ListWithTransitions = require('./ListWithTransitions')

// Actions
const appActions = require('../../../../js/actions/appActions')
const windowActions = require('../../../../js/actions/windowActions')

// State
const windowState = require('../../../common/state/windowState')
const tabState = require('../../../common/state//tabState')

// Constants
const dragTypes = require('../../../../js/constants/dragTypes')
const settings = require('../../../../js/constants/settings')

// Utils
const cx = require('../../../../js/lib/classSet')
const contextMenus = require('../../../../js/contextMenus')
const {getCurrentWindowId, isFocused} = require('../../currentWindow')
const frameStateUtil = require('../../../../js/state/frameStateUtil')
const {getSetting} = require('../../../../js/settings')

class Tabs extends React.Component {
  constructor (props) {
    super(props)
    this.onDragOver = this.onDragOver.bind(this)
    this.onDrop = this.onDrop.bind(this)
    this.onPrevPage = this.onPrevPage.bind(this)
    this.onNextPage = this.onNextPage.bind(this)
    this.onNewTabLongPress = this.onNewTabLongPress.bind(this)
    this.onMouseLeave = this.onMouseLeave.bind(this)
  }

  onMouseLeave () {
    if (this.props.fixTabWidth == null) {
      return
    }

    windowActions.onTabMouseLeave({
      fixTabWidth: null
    })
  }

  onPrevPage () {
    if (this.props.tabPageIndex === 0) {
      return
    }

    windowActions.setTabPageIndex(this.props.tabPageIndex - 1)
  }

  onNextPage () {
    if (this.props.tabPageIndex + 1 === this.props.totalPages) {
      return
    }

    windowActions.setTabPageIndex(this.props.tabPageIndex + 1)
  }

  onDrop (e) {
    appActions.dataDropped(getCurrentWindowId())

    if (e.dataTransfer.files) {
      Array.from(e.dataTransfer.items).forEach((item) => {
        if (item.kind === 'string') {
          return appActions.createTabRequested({url: item.type})
        }
      })
    }
  }

  onDragOver (e) {
    let intersection = e.dataTransfer.types.filter((x) => ['Files'].includes(x))
    if (intersection.length > 0) {
      e.dataTransfer.dropEffect = 'copy'
      e.preventDefault()
    }
  }

  newTab () {
    appActions.createTabRequested({})
  }

  onNewTabLongPress (target) {
    contextMenus.onNewTabContextMenu(target)
  }

  mergeProps (state, ownProps) {
    const currentWindow = state.get('currentWindow')
    const pageIndex = frameStateUtil.getTabPageIndex(currentWindow)
    const tabsPerTabPage = Number(getSetting(settings.TABS_PER_PAGE))
    const startingFrameIndex = pageIndex * tabsPerTabPage
    const unpinnedTabs = frameStateUtil.getNonPinnedFrames(currentWindow) || Immutable.List()
    const currentTabs = unpinnedTabs
      .slice(startingFrameIndex, startingFrameIndex + tabsPerTabPage)
      .filter(tab => tab)
    const totalPages = Math.ceil(unpinnedTabs.size / tabsPerTabPage)
    const activeFrame = frameStateUtil.getActiveFrame(currentWindow) || Immutable.Map()
    const dragData = (state.getIn(['dragData', 'type']) === dragTypes.TAB && state.get('dragData')) || Immutable.Map()

    const props = {}
    // used in renderer
    props.previewTabPageIndex = currentWindow.getIn(['ui', 'tabs', 'previewTabPageIndex'])
    props.currentTabs = currentTabs
    props.partOfFullPageSet = currentTabs.size === tabsPerTabPage
    props.onNextPage = currentTabs.size >= tabsPerTabPage && totalPages > pageIndex + 1
    props.onPreviousPage = pageIndex > 0
    props.shouldAllowWindowDrag = windowState.shouldAllowWindowDrag(state, currentWindow, activeFrame, isFocused(state))

    // tab dragging
    props.draggingTabId = tabState.draggingTabId(state)

    // used in other functions
    props.fixTabWidth = currentWindow.getIn(['ui', 'tabs', 'fixTabWidth'])
    props.tabPageIndex = currentWindow.getIn(['ui', 'tabs', 'tabPageIndex'])
    props.dragData = dragData
    props.dragWindowId = dragData.get('windowId')
    props.totalPages = totalPages
    return props
  }

  render () {
    const isPreview = this.props.previewTabPageIndex != null
    return <div
      data-test-tabs
      className='tabs'
      onMouseLeave={this.onMouseLeave}>
      {[
        <ListWithTransitions
          key={!isPreview ? 'normal' : this.props.previewTabPageIndex}
          disableAllAnimations={isPreview}
          typeName='span'
          duration={710}
          delay={0}
          staggerDelayBy={0}
          easing='cubic-bezier(0.23, 1, 0.32, 1)'
          enterAnimation={this.props.draggingTabId != null ? null : [
            {
              transform: 'translateY(50%)'
            },
            {
              transform: 'translateY(0)'
            }
          ]}
          leaveAnimation={this.props.draggingTabId != null ? null : [
            {
              transform: 'translateY(0)'
            },
            {
              transform: 'translateY(100%)'
            }
          ]}
          className={cx({
            tabStripContainer: true,
            isPreview,
            allowDragging: this.props.shouldAllowWindowDrag
          })}
          onDragOver={this.onDragOver}
          onDrop={this.onDrop}>
          {
            this.props.onPreviousPage
              ? <span
                key='prev'
                className='prevTab fa fa-caret-left'
                onClick={this.onPrevPage} />
              : null
          }
          {
            this.props.currentTabs
              .map((frame, tabDisplayIndex) =>
                <Tab
                  key={`tab-${frame.get('tabId')}-${frame.get('key')}`}
                  frame={frame}
                  isDragging={this.props.draggingTabId === frame.get('tabId')}
                  displayIndex={tabDisplayIndex}
                  displayedTabCount={this.props.currentTabs.count()}
                  singleTab={this.props.currentTabs.count() === 1}
                  partOfFullPageSet={this.props.partOfFullPageSet} />
              )
          }
          {
            this.props.onNextPage
              ? <span
                key='next'
                className='nextTab fa fa-caret-right'
                onClick={this.onNextPage} />
              : null
          }
          <LongPressButton
            key='add'
            label='+'
            l10nId='newTabButton'
            className='browserButton navbutton newFrameButton'
            disabled={false}
            onClick={this.newTab}
            onLongPress={this.onNewTabLongPress}
          />
        </ListWithTransitions>
      ]}
    </div>
  }
}

module.exports = ReduxComponent.connect(Tabs)
