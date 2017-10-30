/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const React = require('react')
const Immutable = require('immutable')

// Components
const ReduxComponent = require('../reduxComponent')
const Tab = require('./tab')

// Store
const windowStore = require('../../../../js/stores/windowStore')

// Utils
const frameStateUtil = require('../../../../js/state/frameStateUtil')
const tabState = require('../../../common/state//tabState')

class PinnedTabs extends React.Component {
  dropFrame (frameKey) {
    return windowStore.getFrame(frameKey)
  }

  mergeProps (state, ownProps) {
    const currentWindow = state.get('currentWindow')
    const pinnedFrames = frameStateUtil.getPinnedFrames(currentWindow) || Immutable.List()

    const props = {}
    // used in renderer
    props.pinnedTabs = pinnedFrames
    props.draggingTabId = tabState.draggingTabId(state)
    return props
  }

  render () {
    return <div
      data-test-pinnedTabs
      className='pinnedTabs'
      onDragOver={this.onDragOver}
      onDrop={this.onDrop}>
      {
        this.props.pinnedTabs
          .map((frame, tabDisplayIndex) =>
            <Tab
              frame={frame}
              key={`tab-${frame.get('tabId')}-${frame.get('key')}`}
              isDragging={this.props.draggingTabId === frame.get('tabId')}
              displayIndex={tabDisplayIndex}
              displayedTabCount={this.props.pinnedTabs.count()}
              singleTab={this.props.pinnedTabs.count() === 1}
            />
          )
      }
    </div>
  }
}

module.exports = ReduxComponent.connect(PinnedTabs)
