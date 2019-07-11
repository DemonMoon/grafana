import _ from 'lodash';

import kbn from 'app/core/utils/kbn';

import { PanelCtrl } from 'app/features/panel/panel_ctrl';
import { getExploreUrl } from 'app/core/utils/explore';
import { applyPanelTimeOverrides, getResolution } from 'app/features/dashboard/utils/panel';
import { ContextSrv } from 'app/core/services/context_srv';
import { toLegacyResponseData, isSeriesData, LegacyResponseData, TimeRange } from '@grafana/ui';

import * as dateMath from '@grafana/ui/src/utils/datemath';
import * as rangeUtil from '@grafana/ui/src/utils/rangeutil';
import { Unsubscribable } from 'rxjs';

class MetricsPanelCtrl extends PanelCtrl {
  scope: any;
  datasource: any;
  $q: any;
  $timeout: any;
  contextSrv: ContextSrv;
  datasourceSrv: any;
  timeSrv: any;
  templateSrv: any;
  range: TimeRange;
  interval: any;
  intervalMs: any;
  resolution: any;
  timeInfo?: string;
  skipDataOnInit: boolean;
  dataStream: any;
  dataSubscription?: Unsubscribable;
  dataList: LegacyResponseData[];

  constructor($scope, $injector) {
    super($scope, $injector);

    this.$q = $injector.get('$q');
    this.contextSrv = $injector.get('contextSrv');
    this.datasourceSrv = $injector.get('datasourceSrv');
    this.timeSrv = $injector.get('timeSrv');
    this.templateSrv = $injector.get('templateSrv');
    this.scope = $scope;
    this.panel.datasource = this.panel.datasource || null;

    this.events.on('refresh', this.onMetricsPanelRefresh.bind(this));
    this.events.on('panel-teardown', this.onPanelTearDown.bind(this));
  }

  private onPanelTearDown() {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
      this.dataSubscription = null;
    }
  }

  private onMetricsPanelRefresh() {
    // ignore fetching data if another panel is in fullscreen
    if (this.otherPanelInFullscreenMode()) {
      return;
    }

    // if we have snapshot data use that
    if (this.panel.snapshotData) {
      this.updateTimeRange();
      let data = this.panel.snapshotData;
      // backward compatibility
      if (!_.isArray(data)) {
        data = data.data;
      }

      // Defer panel rendering till the next digest cycle.
      // For some reason snapshot panels don't init at this time, so this helps to avoid rendering issues.
      return this.$timeout(() => {
        this.events.emit('data-snapshot-load', data);
      });
    }

    // // ignore if we have data stream
    if (this.dataStream) {
      return;
    }

    // clear loading/error state
    delete this.error;
    this.loading = true;

    // load datasource service
    this.datasourceSrv
      .get(this.panel.datasource, this.panel.scopedVars)
      .then(this.updateTimeRange.bind(this))
      .then(this.issueQueries.bind(this))
      .then(this.compareQueries.bind(this))
      .then(this.handleQueryResult.bind(this))
      .catch(err => {
        // if canceled  keep loading set to true
        if (err.cancelled) {
          console.log('Panel request cancelled', err);
          return;
        }

        this.loading = false;
        this.error = err.message || 'Request Error';
        this.inspector = { error: err };

        if (err.data) {
          if (err.data.message) {
            this.error = err.data.message;
          }
          if (err.data.error) {
            this.error = err.data.error;
          }
        }

        this.events.emit('data-error', err);
        console.log('Panel data error:', err);
      });
  }

  updateTimeRange(datasource?) {
    this.datasource = datasource || this.datasource;
    this.range = this.timeSrv.timeRange();
    this.resolution = getResolution(this.panel);

    const newTimeData = applyPanelTimeOverrides(this.panel, this.range);
    this.timeInfo = newTimeData.timeInfo;
    this.range = newTimeData.timeRange;

    this.calculateInterval();

    return this.datasource;
  }

  calculateInterval() {
    let intervalOverride = this.panel.interval;

    // if no panel interval check datasource
    if (intervalOverride) {
      intervalOverride = this.templateSrv.replace(intervalOverride, this.panel.scopedVars);
    } else if (this.datasource && this.datasource.interval) {
      intervalOverride = this.datasource.interval;
    }

    const res = kbn.calculateInterval(this.range, this.resolution, intervalOverride);
    this.interval = res.interval;
    this.intervalMs = res.intervalMs;
  }

  issueQueries(datasource) {
    this.datasource = datasource;

    if (!this.panel.targets || this.panel.targets.length === 0) {
      return this.$q.when([]);
    }

    // make shallow copy of scoped vars,
    // and add built in variables interval and interval_ms
    const scopedVars = Object.assign({}, this.panel.scopedVars, {
      __interval: { text: this.interval, value: this.interval },
      __interval_ms: { text: this.intervalMs, value: this.intervalMs },
    });

    const metricsQuery = {
      timezone: this.dashboard.getTimezone(),
      panelId: this.panel.id,
      dashboardId: this.dashboard.id,
      range: this.range,
      rangeRaw: this.range.raw,
      interval: this.interval,
      intervalMs: this.intervalMs,
      targets: this.panel.targets,
      maxDataPoints: this.resolution,
      scopedVars: scopedVars,
      cacheTimeout: this.panel.cacheTimeout,
    };

    return datasource.query(metricsQuery);
  }
  compareData: any;
  compareQueries(result) {
    if (!this.panel.compareTime) {
      return result;
    }
    const timeShiftInterpolated = this.templateSrv.replace(this.panel.compareTime, this.panel.scopedVars);
    const timeShiftInfo = rangeUtil.describeTextRange(timeShiftInterpolated);
    if (timeShiftInfo.invalid) {
      // this.timeInfo = 'invalid timeshift';
      return result;
    }

    const scopedVars = Object.assign({}, this.panel.scopedVars, {
      __interval: { text: this.interval, value: this.interval },
      __interval_ms: { text: this.intervalMs, value: this.intervalMs },
    });
    const timeShift = '-' + timeShiftInterpolated;
    console.log(this.range);
    console.log(typeof this.range.from);
    const time1 = this.range.from.clone();
    console.log(time1);
    const time2 = this.range.to.clone();
    const from = dateMath.parseDateMath(timeShift, time1, false);
    const to = dateMath.parseDateMath(timeShift, time2, true);
    const raw = { from: from, to: to };

    const rangeC = { from: from, to: to, raw: raw };
    const metricsQuery2 = {
      timezone: this.dashboard.getTimezone(),
      panelId: this.panel.id,
      dashboardId: this.dashboard.id,
      range: rangeC,
      rangeRaw: raw,
      interval: this.interval,
      intervalMs: this.intervalMs,
      targets: this.panel.targets,
      maxDataPoints: this.resolution,
      scopedVars: scopedVars,
      cacheTimeout: this.panel.cacheTimeout,
    };
    const c = this.datasource.query(metricsQuery2);
    this.compareData = result;
    return c;
  }
  getCompareData(result, compareTime, compareTimeName) {
    // var result = res.$$state.value;

    if (!result || !result.data) {
      console.log('Data source query result invalid, missing data field:', result);
      result = { data: [] };
      return result;
    }
    const timeShiftInterpolated = this.templateSrv.replace(this.panel.compareTime, this.panel.scopedVars);
    const timeShiftInfo = rangeUtil.describeTextRange(timeShiftInterpolated);
    if (timeShiftInfo.invalid) {
      // this.timeInfo = 'invalid timeshift';
      return result;
    }
    const timeShift = '+' + timeShiftInterpolated;
    const t1 = dateMath.parseMillsTime(timeShift);
    for (let i = 0; i < result.data.length; i++) {
      const r = result.data[i];
      r.target = compareTimeName ? r.target + ' - ' + compareTimeName : r.target + ' - ' + compareTime;
      for (let j = 0; j < r.datapoints.length; j++) {
        const len = r.datapoints[j].length;
        const t = r.datapoints[j][len - 1];
        r.datapoints[j][len - 1] = t + t1;
      }
    }
    return result;
  }
  handleQueryResult(res) {
    // this.setTimeQueryEnd();
    this.loading = false;
    let result = res;
    //check compare
    if (this.panel.compareTime) {
      result = this.compareData;
      const d = [];
      result.data = d.concat(
        result.data,
        this.getCompareData(res, this.panel.compareTime, this.panel.compareTimeName).data
      );
    }
    // check for if data source returns subject
    if (result && result.subscribe) {
      this.handleDataStream(result);
      return;
    }

    if (this.dashboard.snapshot) {
      this.panel.snapshotData = result.data;
    }

    if (!result || !result.data) {
      console.log('Data source query result invalid, missing data field:', result);
      result = { data: [] };
    }

    // Some data is not an array (like table annotations)
    if (!Array.isArray(result.data)) {
      this.events.emit('data-received', result.data);
      return;
    }

    // Make sure the data is TableData | TimeSeries
    const data = result.data.map(v => {
      if (isSeriesData(v)) {
        return toLegacyResponseData(v);
      }
      return v;
    });
    this.events.emit('data-received', data);
  }

  handleDataStream(stream) {
    // if we already have a connection
    if (this.dataStream) {
      console.log('two stream observables!');
      return;
    }

    this.dataStream = stream;
    this.dataSubscription = stream.subscribe({
      next: data => {
        console.log('dataSubject next!');
        if (data.range) {
          this.range = data.range;
        }
        this.events.emit('data-received', data.data);
      },
      error: error => {
        this.events.emit('data-error', error);
        console.log('panel: observer got error');
      },
      complete: () => {
        console.log('panel: observer got complete');
        this.dataStream = null;
      },
    });
  }

  getAdditionalMenuItems() {
    const items = [];
    if (this.contextSrv.hasAccessToExplore() && this.datasource) {
      items.push({
        text: 'Explore',
        click: 'ctrl.explore();',
        icon: 'gicon gicon-explore',
        shortcut: 'x',
      });
    }
    return items;
  }

  async explore() {
    const url = await getExploreUrl(this.panel, this.panel.targets, this.datasource, this.datasourceSrv, this.timeSrv);
    if (url) {
      this.$timeout(() => this.$location.url(url));
    }
  }
}

export { MetricsPanelCtrl };
