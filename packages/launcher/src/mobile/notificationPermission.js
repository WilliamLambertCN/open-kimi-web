{
  const NotificationApi = window.Notification;
  const nativeRequestPermission = NotificationApi?.requestPermission;

  if (typeof nativeRequestPermission === 'function') {
    let requestInFlight = null;
    let dismissed = false;
    let currentInput = null;

    const rememberInput = (event) => {
      if (event.isTrusted) currentInput = event;
    };
    window.addEventListener('click', rememberInput, true);
    window.addEventListener('keydown', rememberInput, true);

    const isDirectUserRequest = () => {
      const activation = navigator.userActivation;
      return currentInput !== null && currentInput.eventPhase !== 0 &&
        (activation === undefined || activation.isActive);
    };

    const withCallback = (request, callback) => {
      if (typeof callback === 'function') {
        void request.then((permission) => callback(permission)).catch(() => {});
      }
      return request;
    };

    NotificationApi.requestPermission = function requestPermission(callback) {
      if (requestInFlight !== null) return withCallback(requestInFlight, callback);
      if (dismissed && NotificationApi.permission === 'default' && !isDirectUserRequest()) {
        return withCallback(Promise.resolve('default'), callback);
      }

      let nativeRequest;
      try {
        nativeRequest = nativeRequestPermission.call(NotificationApi);
      } catch (error) {
        return withCallback(Promise.reject(error), callback);
      }

      const trackedRequest = Promise.resolve(nativeRequest).then((permission) => {
        dismissed = permission === 'default';
        return permission;
      });
      requestInFlight = trackedRequest;
      const clear = () => {
        if (requestInFlight === trackedRequest) requestInFlight = null;
      };
      void trackedRequest.then(clear, clear);
      return withCallback(trackedRequest, callback);
    };
  }
}
