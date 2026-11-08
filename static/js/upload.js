(() => {
  const label = document.querySelector('.upload');
  const fileInput = document.querySelector('.upload-input');
  const idleText = document.querySelector('.upload-label');
  const progressContainer = document.querySelector('.upload-progress');
  const progressText = document.querySelector('.upload-progress-text');
  const progressBar = document.querySelector('.upload-progress .progress-inner');
  const uploadedProject = document.querySelector('.uploaded-project');
  const uploadedProjectLink = document.querySelector('.uploaded-project-link');

  let isUploading = false;

  const setProgress = (text, progress) => {
    progressText.textContent = text;
    progressBar.style.width = `${progress * 100}%`;
  };

  const setUploading = (uploading) => {
    isUploading = uploading;
    label.classList.toggle('uploading', uploading);
    fileInput.disabled = uploading;
    fileInput.hidden = uploading;
    idleText.hidden = uploading;
    progressContainer.hidden = !uploading;
  };

  const createLimiter = (callback, maxConcurrent) => {
    let current = 0;
    const queue = [];

    const startNext = () => {
      if (current >= maxConcurrent || queue.length === 0) {
        return;
      }

      current += 1;
      const [resolve, reject, args] = queue.shift();

      callback(...args)
        .then(resolve, reject)
        .finally(() => {
          current -= 1;
          startNext();
        });
    };

    return (...args) => new Promise((resolve, reject) => {
      queue.push([resolve, reject, args]);
      startNext();
    });
  };

  const sha256 = async (data) => {
    const buffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };

  const uploadProject = async (file) => {
    const title = file.name.replace(/\.sb3$/, '');

    setProgress('Extracting project', 0.05);
    const zip = await JSZip.loadAsync(file);

    const projectJSONFile = zip.file('project.json');
    if (!projectJSONFile) {
      throw new Error('No project.json');
    }
    const projectJSONText = await projectJSONFile.async('text');
    const parsedProject = parseProject(projectJSONText);

    const assetInformation = {};
    await Promise.all(parsedProject.md5exts.map(async (md5ext) => {
      const assetFile = zip.file(md5ext);
      if (!assetFile) {
        throw new Error(`Missing asset: ${md5ext}`);
      }
      const data = await assetFile.async('arraybuffer');
      assetInformation[md5ext] = {
        sha256: await sha256(data),
        size: data.byteLength
      };
    }));

    setProgress('Uploading project data', 0.1);
    const incompleteProject = await (await fetchWithErrorHandling('/api/projects/new', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        project: projectJSONText,
        assetInformation,
        title
      })
    })).json();

    const {projectId, ownershipToken, missingMd5exts} = incompleteProject;

    setProgress('Uploading assets', 0.2);
    let uploadedAssets = 0;

    const uploadAsset = async (md5ext) => {
      const assetFile = zip.file(md5ext);
      if (!assetFile) {
        throw new Error(`Missing asset file: ${md5ext}`);
      }
      const assetData = await assetFile.async('blob');
      const res = await fetchWithErrorHandling(`/api/projects/${projectId}/assets/${md5ext}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-ownership-token': ownershipToken
        },
        body: assetData
      });
      await res.json();
      uploadedAssets++;
      setProgress('Uploading assets', 0.2 + (uploadedAssets / missingMd5exts.length) * 0.8);
    };
    // Browsers tend to throw errors if we try to send too many requests at once, so we throttle them a
    // little bit.
    const throttledUploadAsset = createLimiter(uploadAsset, 25);
    await Promise.all(missingMd5exts.map(throttledUploadAsset));

    setProgress('Finalizing', 1);
    await fetchWithErrorHandling(`/api/projects/${projectId}/complete`, {
      method: 'POST',
      headers: {
        'x-ownership-token': ownershipToken
      }
    });

    return {
      projectId,
      ownershipToken
    };
  };

  const fileInputChanged = async () => {
    const file = fileInput.files[0];
    if (!file || isUploading) {
      return;
    }

    try {
      setUploading(true);
      setProgress('Loading', 0);
      uploadedProject.hidden = true;

      const {projectId, ownershipToken} = await uploadProject(file);
      storeLocalProjectData(projectId, ownershipToken);

      const projectURL = new URL(`/projects/${projectId}`, location.href).href;
      uploadedProjectLink.href = projectURL;
      uploadedProjectLink.textContent = projectURL;
      uploadedProject.hidden = false;
    } catch (e) {
      console.error(e);
      alert(e);
    }

    setUploading(false);
  };

  fileInput.addEventListener('change', fileInputChanged);

  const hasFile = (transfer) => !!transfer && transfer.types.includes('Files');
  window.addEventListener('dragover', (e) => {
    if (hasFile(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      label.classList.add('dropping');
    }
  });
  window.addEventListener('dragleave', () => {
    label.classList.remove('dropping');
  });
  window.addEventListener('drop', (e) => {
    label.classList.remove('dropping');
    if (hasFile(e.dataTransfer)) {
      e.preventDefault();
      fileInput.files = e.dataTransfer.files;
      fileInputChanged();
    }
  });
})();
