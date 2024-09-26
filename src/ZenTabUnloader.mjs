
{
  const ZEN_TAB_UNLOADER_PREF = "zen.tab-unloader.enabled";
  const ZEN_TAB_UNLOADER_TIMEOUT_PREF = "zen.tab-unloader.timeout";

  const lazy = {};

  XPCOMUtils.defineLazyPreferenceGetter(
    lazy,
    "zenTabUnloaderEnabled",
    "zen.tab-unloader.enabled",
    false
  );

  XPCOMUtils.defineLazyPreferenceGetter(
    lazy,
    "zenTabUnloaderTimeout",
    "zen.tab-unloader.timeout-minutes",
    5
  );

  XPCOMUtils.defineLazyPreferenceGetter(
    lazy,
    "zenTabUnloaderExcludedUrls",
    "zen.tab-unloader.excluded-urls",
    ""
  );

  const ZEN_TAB_UNLOADER_DEFAULT_EXCLUDED_URLS = [
    "^about:",
    "^chrome:",
    "^devtools:",    
    "^file:",
    "^resource:",
    "^view-source:",
    "^view-image:",
  ];

  class ZenTabsObserver {
    static ALL_EVENTS = [
      "TabAttrModified",
      "TabPinned",
      "TabUnpinned",
      "TabBrowserInserted",
      "TabBrowserDiscarded",
      "TabShow",
      "TabHide",
      "TabOpen",
      "TabClose",
      "TabSelect",
      "TabMultiSelect",
    ]

    #listeners = [];

    constructor() {
      this.#listenAllEvents();
    }

    #listenAllEvents() {
      const eventListener = this.#eventListener.bind(this);
      for (const event of ZenTabsObserver.ALL_EVENTS) {
        window.addEventListener(event, eventListener);
      }
      window.addEventListener("unload", () => {
        for (const event of ZenTabsObserver.ALL_EVENTS) {
          window.removeEventListener(event, eventListener);
        }
      });
    }

    #eventListener(event) {
      for (const listener of this.#listeners) {
        listener(event.type, event);
      }
    }

    addTabsListener(listener) {
      this.#listeners.push(listener);
    }
  }

  class ZenTabsIntervalUnloader {
    static INTERVAL = 1000 * 60; // 1 minute
    
    interval = null;
    unloader = null;

    #excludedUrls = [];
    #compiledExcludedUrls = [];

    constructor(unloader) {
      this.unloader = unloader;
      this.interval = setInterval(this.intervalListener.bind(this), ZenTabsIntervalUnloader.INTERVAL);
      this.#excludedUrls = this.lazyExcludeUrls;
    }

    get lazyExcludeUrls() {
      return [
        ...ZEN_TAB_UNLOADER_DEFAULT_EXCLUDED_URLS,
        ...lazy.zenTabUnloaderExcludedUrls.split(",").map(url => url.trim())
      ];
    }

    arraysEqual(a, b) {
      if (a === b) return true;
      if (a == null || b == null) return false;
      if (a.length !== b.length) return false;
    
      // If you don't care about the order of the elements inside
      // the array, you should sort both arrays here.
      // Please note that calling sort on an array will modify that array.
      // you might want to clone your array first.
    
      for (var i = 0; i < a.length; ++i) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }    

    get excludedUrls() {
      // Check if excludedrls is the same as the pref value
      const excludedUrls = this.lazyExcludeUrls;
      if (!this.arraysEqual(this.#excludedUrls, excludedUrls) || !this.#compiledExcludedUrls.length) {
        this.#excludedUrls = excludedUrls;
        this.#compiledExcludedUrls = excludedUrls.map(url => new RegExp(url));
      }
      return this.#compiledExcludedUrls;
    }

    intervalListener() {
      const currentTimestamp = Date.now();
      const excludedUrls = this.excludedUrls;
      for (const tab of this.unloader.tabs) {
        if (this.unloader.canUnloadTab(tab, currentTimestamp, excludedUrls)) {
          console.debug("ZenTabUnloader: Discarding tab", tab);
          tab.ownerGlobal.gBrowser.discardBrowser(tab);
        }
      }
    }
  }


  class ZenTabUnloader {
    static ACTIVITY_MODIFIERS = [
      "muted",
      "soundplaying",
      "label",
      "attention",
    ]

    allTabs = [];
    constructor() {
      if (!lazy.zenTabUnloaderEnabled) {
        return;
      }
      this.observer = new ZenTabsObserver();
      this.intervalUnloader = new ZenTabsIntervalUnloader(this);
      this.allTabs = gBrowser.tabs;
      this.observer.addTabsListener(this.onTabEvent.bind(this));
    }

    onTabEvent(action, event) {
      const tab = event.target;
      switch (action) {
        case "TabPinned":
        case "TabUnpinned":
        case "TabBrowserInserted":
        case "TabBrowserDiscarded":
        case "TabShow":
        case "TabHide":
          break;
        case "TabAttrModified":
          this.handleTabAttrModified(tab, event);
          break;
        case "TabOpen":
          this.handleTabOpen(tab);
          break;
        case "TabClose":
          this.handleTabClose(tab);
          break;
        case "TabSelect":
        case "TabMultiSelect":
          this.updateTabActivity(tab);
          break;
        default:
          console.warn("ZenTabUnloader: Unhandled tab event", action);
          break;
      }
    }

    onLocationChange(browser) {
      const tab = browser.ownerGlobal.gBrowser.getTabForBrowser(browser);
      this.updateTabActivity(tab);
    }

    handleTabClose(tab) {
      this.allTabs = this.allTabs.filter(t => t !== tab);
    }

    handleTabOpen(tab) {
      if (!lazy.zenTabUnloaderEnabled) {
        return;
      }
      if (this.allTabs.includes(tab)) {
        return;
      }
      this.allTabs.push(tab);
      this.updateTabActivity(tab);
    }

    handleTabAttrModified(tab, event) {
      for (const modifier of ZenTabUnloader.ACTIVITY_MODIFIERS) {
        if (event.detail.changed.includes(modifier)) {
          this.updateTabActivity(tab);
          break;
        }
      }
    }

    updateTabActivity(tab) {
      const currentTimestamp = Date.now();
      tab.lastActivity = currentTimestamp;
    }

    get tabs() {
      return this.allTabs;
    }

    canUnloadTab(tab, currentTimestamp, excludedUrls) {
      if (tab.pinned || tab.selected || tab.multiselected
        || tab.hasAttribute("busy") || tab.hasAttribute("pending")
        || !tab.linkedPanel || tab.splitView || tab.attention
        || excludedUrls.some(url => url.test(tab.linkedBrowser.currentURI.spec))) {
        return false;
      }
      const lastActivity = tab.lastActivity;
      if (!lastActivity) {
        return false;
      }
      const diff = currentTimestamp - lastActivity;
      // Check if the tab has been inactive for more than the timeout
      if (diff < lazy.zenTabUnloaderTimeout * 60 * 1000) {
        return false;
      }
      return true;
    }
  }
  
  window.gZenTabUnloader = new ZenTabUnloader();
}
