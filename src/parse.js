// This file runs on both the server (require()) and in the browser (plain <script>, exposes window.parseProject).
(function () {
  const DATA_FORMATS = [
    'png',
    'jpg',
    'svg',
    'mp3',
    'wav'
  ];

  // intentionally not case insensitive
  const ASSET_ID_REGEX = /^[0-9a-f]{32}$/;

  const isObject = (i) => typeof i === 'object' && !!i;

  /**
   * @param {string} projectData project.json as a string
   * @returns {{md5exts: string[]}}
   */
  const parseProject = (projectData) => {
    const projectJSON = JSON.parse(projectData);

    if (!isObject(projectJSON)) {
      throw new Error('project is not an object');
    }

    const targets = projectJSON.targets;
    if (!Array.isArray(targets)) {
      throw new Error('targets is not an array');
    }

    const md5exts = targets
      .map((target) => {
        if (!isObject(target)) {
          throw new Error('target is not an object');
        }

        const costumes = target.costumes;
        if (!Array.isArray(costumes)) {
          throw new Error('costumes is not an array');
        }

        const sounds = target.sounds;
        if (!Array.isArray(sounds)) {
          throw new Error('sounds is not an array');
        }

        return [...costumes, ...sounds];
      })
      .flat()
      .map((asset) => {
        if (!isObject(asset)) {
          throw new Error('asset is not an object');
        }

        const md5 = asset.assetId;
        if (typeof md5 !== 'string') {
          throw new Error('md5 is not string');
        }
        if (!ASSET_ID_REGEX.test(md5)) {
          throw new Error(`Invalid md5: ${md5}`);
        }

        const dataFormat = asset.dataFormat;
        if (typeof dataFormat !== 'string') {
          throw new Error('dataFormat is not string');
        }
        if (!DATA_FORMATS.includes(dataFormat.toLowerCase())) {
          throw new Error(`Unknown data format: ${dataFormat}`);
        }

        return `${md5}.${dataFormat}`;
      });

    return {
      md5exts: Array.from(new Set(md5exts))
    };
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      parseProject
    };
  } else {
    window.parseProject = parseProject;
  }
})();
