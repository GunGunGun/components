async function fixContentDecryption() {
  function findElementInArray(array, name) {
    const rv = array.find((element) => element.includes(name));
    return rv ? rv.split("=")[1] : "Unknown";
  }
  function getAudioRobustness(array) {
    return findElementInArray(array, "audio-robustness");
  }

  function getVideoRobustness(array) {
    return findElementInArray(array, "video-robustness");
  }

  function getSupportedCodecs(array) {
    const mp4Content = findElementInArray(array, "MP4");
    const webContent = findElementInArray(array, "WEBM");

    const mp4DecodingAndDecryptingCodecs = mp4Content
      .match(/decoding-and-decrypting:\[([^\]]*)\]/)[1]
      .split(",");
    const webmDecodingAndDecryptingCodecs = webContent
      .match(/decoding-and-decrypting:\[([^\]]*)\]/)[1]
      .split(",");

    const mp4DecryptingOnlyCodecs = mp4Content
      .match(/decrypting-only:\[([^\]]*)\]/)[1]
      .split(",");
    const webmDecryptingOnlyCodecs = webContent
      .match(/decrypting-only:\[([^\]]*)\]/)[1]
      .split(",");

    // Combine and get unique codecs for decoding-and-decrypting (always)
    // and decrypting-only (only set when it's not empty)
    let rv = {};
    rv.decodingAndDecrypting = [
      ...new Set(
        [
          ...mp4DecodingAndDecryptingCodecs,
          ...webmDecodingAndDecryptingCodecs,
        ].filter(Boolean)
      ),
    ];
    let temp = [
      ...new Set(
        [...mp4DecryptingOnlyCodecs, ...webmDecryptingOnlyCodecs].filter(
          Boolean
        )
      ),
    ];
    if (temp.length) {
      rv.decryptingOnly = temp;
    }
    return rv;
  }

  function getCapabilities(array) {
    let capabilities = {};
    capabilities.persistent = findElementInArray(array, "persistent");
    capabilities.distinctive = findElementInArray(array, "distinctive");
    capabilities.sessionType = findElementInArray(array, "sessionType");
    capabilities.codec = getSupportedCodecs(array);
    return capabilities;
  }

  let rows = [];
  // Retrieve information from GMPCDM
  let cdmInfo = await ChromeUtils.getGMPContentDecryptionModuleInformation();
  for (let info of cdmInfo) {
    rows.push(info);
  }
  // Retrieve information from WMFCDM, only works when MOZ_WMF_CDM is true
  if (ChromeUtils.getWMFContentDecryptionModuleInformation !== undefined) {
    cdmInfo = await ChromeUtils.getWMFContentDecryptionModuleInformation();
    for (let info of cdmInfo) {
      rows.push(info);
    }
  }

  var cdmarr = rows[0].capabilities.split(" ");
  var h264 = true;
  var vp9 = false;
  var av1 = false;
  for (var hwdec of getCapabilities(cdmarr).codec.decodingAndDecrypting) {
    if (hwdev.startsWith("vp9")) {
      vp9 = true;
    }
    if (hwdev.startsWith("av1")) {
      av1 = true;
    }
  }
  var PS = Components.classes["@mozilla.org/preferences-service;1"].getService(
    Components.interfaces.nsIPrefBranch
  );
  if (vp9 === false) {
    PS.setBoolPref("media.mediasource.vp9.enabled", false);
  }
  if (av1 === false) {
    PS.setBoolPref("media.av1.enabled", false);
  }
}
window.addEventListener('load', function() {
fixContentDecryption();
console.log('fixed');
});
