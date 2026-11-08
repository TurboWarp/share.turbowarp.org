(() => {
  const CLOUD_HOST = 'wss://cirrus.turbowarp.org';

  const player = document.querySelector('.player');
  const titleInput = document.querySelector('.project-title');

  const projectId = player.dataset.projectId;
  const md5extsToSha256 = JSON.parse(player.dataset.md5extsToSha256);
  const appName = player.dataset.appName;
  const defaultTitle = titleInput.placeholder;

  const ownershipToken = player.dataset.adminOwnershipToken || getOwnershipToken(projectId);
  let projectTitle = titleInput.value;

  const descriptionInput = document.querySelector('.project-description');
  const downloadButton = document.querySelector('.download');
  const reportBodyInput = document.querySelector('.report-body');
  const submitReportButton = document.querySelector('.submit-report');
  const ownerSection = document.querySelector('.owner-section');
  const deleteButton = document.querySelector('.delete-project');

  const playerProject = document.querySelector('.player-project');
  const loadingScreen = document.querySelector('.player-loading');
  const loadingBar = document.querySelector('.loading-bar-inner');
  const errorScreen = document.querySelector('.player-error');
  const errorDetails = document.querySelector('.error-details');

  let vm = null;
  let isStarted = false;

  const setProgress = (progress) => {
    loadingBar.style.width = `${progress * 100}%`;
  };

  const pressGreenFlag = () => {
    vm.greenFlag();
    vm.start();

    if (!isStarted) {
      isStarted = true;
      fetch(`/api/projects/${projectId}/started`, {
        method: 'PUT'
      });
    }
  };

  const createControlButton = (className, iconURL, onClick) => {
    const button = document.createElement('button');
    button.className = `control-button ${className}`;
    button.addEventListener('click', onClick);
    const icon = document.createElement('img');
    icon.src = iconURL;
    button.appendChild(icon);
    return {button, icon};
  };

  const loadProject = async () => {
    const projectData = await (await fetchWithErrorHandling(`/api/projects/${projectId}`)).arrayBuffer();
    setProgress(0.1);

    const scaffolding = new Scaffolding.Scaffolding();
    scaffolding.setup();
    scaffolding.appendTo(playerProject);
    setProgress(0.2);

    scaffolding.setExtensionSecurityManager({
      getSandboxMode: (extension) => {
        if (extension.startsWith('https://extensions.turbowarp.org/')) return 'unsandboxed';
        return 'iframe';
      },
      canLoadExtensionFromProject: (extension) => {
        // Other sandbox modes don't work yet and we don't want completely untrusted JS running
        if (extension.startsWith('https://extensions.turbowarp.org/')) {
          return true;
        }
        throw new Error(`Loading extensions from places other than extensions.turbowarp.org not supported yet: ${extension}`);
      }
    });

    scaffolding.setUsername('player####'.replace(/#/g, () => String(Math.floor(Math.random() * 10))));

    scaffolding.addCloudProvider(new Scaffolding.Cloud.WebSocketProvider(CLOUD_HOST, projectId));

    vm = scaffolding.vm;

    const storage = scaffolding.storage;
    storage.addWebStore(
      [storage.AssetType.ImageVector, storage.AssetType.ImageBitmap, storage.AssetType.Sound],
      (asset) => {
        const md5ext = `${asset.assetId}.${asset.dataFormat}`;
        const sha256 = md5extsToSha256[md5ext];
        if (typeof sha256 !== 'string') {
          throw new Error(`Unknown asset ${md5ext}`);
        }
        return new URL(`/api/assets/${sha256}`, location.href).href;
      }
    );
    storage.onprogress = (total, loaded) => {
      setProgress(0.2 + (loaded / total) * 0.8);
    };

    const flagScreen = document.createElement('button');
    flagScreen.className = 'flag-screen';
    flagScreen.addEventListener('click', () => {
      pressGreenFlag();
      flagScreen.remove();
    });
    const flagScreenIconOuter = document.createElement('div');
    flagScreenIconOuter.className = 'flag-icon';
    const flagScreenIcon = document.createElement('img');
    flagScreenIcon.src = '/icons/green-flag-button.svg';
    flagScreenIconOuter.appendChild(flagScreenIcon);
    flagScreen.appendChild(flagScreenIconOuter);

    const greenFlag = createControlButton('green-flag-button', '/icons/green-flag-button.svg', () => {
      pressGreenFlag();
      flagScreen.remove();
    });
    scaffolding.addControlButton({
      element: greenFlag.button,
      where: 'top-left'
    });
    vm.on('PROJECT_RUN_START', () => {
      greenFlag.button.classList.add('active');
      if (flagScreen.isConnected) {
        flagScreen.remove();
      }
    });
    vm.on('PROJECT_RUN_STOP', () => {
      greenFlag.button.classList.remove('active');
    });

    const stopAll = createControlButton('stop-all-button', '/icons/stop-button.svg', () => {
      vm.stopAll();
    });
    scaffolding.addControlButton({
      element: stopAll.button,
      where: 'top-left'
    });

    const fullscreen = createControlButton('fullscreen-button', '/icons/fullscreen-button.svg', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        player.requestFullscreen();
      }
    });
    document.addEventListener('fullscreenchange', () => {
      const isFullscreen = !!document.fullscreenElement;
      player.classList.toggle('fullscreen', isFullscreen);
      fullscreen.icon.src = isFullscreen ? '/icons/unfullscreen-button.svg' : '/icons/fullscreen-button.svg';
    });
    scaffolding.addControlButton({
      element: fullscreen.button,
      where: 'top-right'
    });

    scaffolding._addLayer(flagScreen);

    await scaffolding.loadProject(projectData);
    player.classList.remove('loading');
    loadingScreen.hidden = true;
  };

  loadProject().catch((e) => {
    console.error(e);
    errorDetails.textContent = `${e}`;
    errorScreen.hidden = false;
  });

  downloadButton.addEventListener('click', async () => {
    if (!vm) {
      return;
    }
    const blob = await vm.saveProjectSb3();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectTitle}.sb3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const updateProject = async (changes) => {
    try {
      await fetchWithErrorHandling(`/api/projects/${projectId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ownership-token': ownershipToken
        },
        body: JSON.stringify(changes)
      });
    } catch (e) {
      alert(e);
    }
  };

  if (ownershipToken) {
    titleInput.readOnly = false;
    descriptionInput.readOnly = false;
    ownerSection.hidden = false;

    titleInput.addEventListener('change', () => {
      projectTitle = titleInput.value;
      document.title = `${projectTitle || defaultTitle} - ${appName}`;
      updateProject({
        title: projectTitle
      });
    });

    descriptionInput.addEventListener('change', () => {
      updateProject({
        description: descriptionInput.value
      });
    });

    deleteButton.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to delete the project? THIS CANNOT BE UNDONE.')) {
        return;
      }
      try {
        await fetchWithErrorHandling(`/api/projects/${projectId}`, {
          method: 'DELETE',
          headers: {
            'x-ownership-token': ownershipToken
          }
        });
        location.href = '/deleted';
      } catch (e) {
        alert(e);
      }
    });
  }

  submitReportButton.addEventListener('click', async () => {
    const reportBody = reportBodyInput.value;
    if (reportBody.length < 20) {
      alert('Your reason for reporting is too short. Please add additional explanation.');
      return;
    }

    submitReportButton.disabled = true;
    reportBodyInput.readOnly = true;

    try {
      await fetchWithErrorHandling(`/api/projects/${projectId}/report`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          body: reportBody
        })
      });

      alert([
        'A report has been submitted and will be reviewed by a volunteer. Thank you.\n\n',
        'Reporting a project multiple times does not change its place in the queue.'
      ].join(''));
    } catch (e) {
      alert(e);
    }

    submitReportButton.disabled = false;
    reportBodyInput.readOnly = false;
  });
})();
