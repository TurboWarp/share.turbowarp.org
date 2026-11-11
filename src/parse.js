// This file runs on both the server (require()) and in the browser (plain <script>, exposes window.parseProject).
(function () {
  const DATA_FORMATS = [
    'png',
    'jpg',
    'svg',
    'mp3',
    'wav'
  ];

  const FONT_FORMATS = [
    'ttf',
    'otf',
    'woff',
    'woff2'
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

    // TurboWarp custom fonts: [{system: false, family, fallback, md5ext}] or [{system: true, family, fallback}]
    const customFonts = projectJSON.customFonts;
    if (customFonts !== undefined && customFonts !== null) {
      if (!Array.isArray(customFonts)) {
        throw new Error('customFonts is not an array');
      }

      for (const font of customFonts) {
        if (!isObject(font)) {
          throw new Error('font is not an object');
        }
        if (font.system) {
          continue;
        }

        const md5ext = font.md5ext;
        if (typeof md5ext !== 'string') {
          throw new Error('font md5ext is not string');
        }
        const [md5, dataFormat, ...rest] = md5ext.split('.');
        if (!ASSET_ID_REGEX.test(md5) || rest.length !== 0) {
          throw new Error(`Invalid font md5ext: ${md5ext}`);
        }
        // Case sensitive because the player looks up fonts using the lowercase extension
        if (!FONT_FORMATS.includes(dataFormat)) {
          throw new Error(`Unknown font format: ${dataFormat}`);
        }

        md5exts.push(md5ext);
      }
    }

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
