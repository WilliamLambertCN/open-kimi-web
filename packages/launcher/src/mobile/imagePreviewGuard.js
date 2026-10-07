{
  const guardKey = Symbol.for('open-kimi-web.image-preview-guard');

  if (!window[guardKey]) {
    window[guardKey] = true;
    const nativeFetch = window.fetch;
    const readPath = /^\/api\/v1\/sessions\/[^/]+\/fs:read$/;
    const maxBytes = 32 * 1024 * 1024;
    const imageExtension = /\.(?:png|jpe?g|gif|svg)$/i;

    const requestOption = (input, init, name, fallback) => {
      if (init?.[name] !== undefined) return init[name];
      return input instanceof Request ? input[name] : fallback;
    };

    const requestBody = async (input, init) => {
      if (init?.body != null) return typeof init.body === 'string' ? init.body : null;
      return input instanceof Request ? input.clone().text() : null;
    };

    const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

    const validPath = (path) => {
      if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) return false;
      return !path.split('/').some((part) => part === '.' || part === '..');
    };

    const validOptions = (options) => {
      if (!isObject(options) || !validPath(options.path)) return false;
      if (Object.keys(options).some((key) => !['path', 'offset', 'encoding'].includes(key))) return false;
      if (options.offset !== undefined && options.offset !== 0) return false;
      return options.encoding === undefined || ['auto', 'base64'].includes(options.encoding);
    };

    const readUrl = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = String(requestOption(input, init, 'method', 'GET')).toUpperCase();
      if (url.origin !== location.origin || url.search !== '' || method !== 'POST' || !readPath.test(url.pathname)) {
        return null;
      }
      return url;
    };

    const readRequest = async (input, init) => {
      try {
        const url = readUrl(input, init);
        if (url === null) return null;
        const headers = new Headers(requestOption(input, init, 'headers'));
        if (headers.has('range') || headers.has('if-range')) return null;
        const body = await requestBody(input, init);
        if (body === null) return null;
        const options = JSON.parse(body);
        if (!validOptions(options)) return null;
        const path = options.path.split('/').map(encodeURIComponent).join('/');
        const downloadUrl = `${url.origin}${url.pathname.slice(0, -':read'.length)}/${path}:download`;
        return { options, downloadUrl, headers };
      } catch {
        return null;
      }
    };

    const imageMime = (value) => {
      if (typeof value !== 'string') return null;
      const mime = value.split(';')[0].trim().toLowerCase();
      return /^image\/[a-z0-9.+-]+$/.test(mime) ? mime : null;
    };

    const truncatedImage = (file) => (
      isObject(file) && file.encoding === 'base64' && file.truncated === true && imageMime(file.mime) !== null
    );

    const readMetadata = async (response, request) => {
      try {
        const envelope = await response.clone().json();
        if (!isObject(envelope)) return null;
        if (response.ok && envelope.code === 0 && truncatedImage(envelope.data)) {
          return { envelope, file: envelope.data };
        }
        if ([200, 413].includes(response.status) && envelope.code === 41302 && imageExtension.test(request.options.path)) {
          return { envelope, file: null };
        }
        return null;
      } catch {
        return null;
      }
    };

    const errorCode = Symbol('image-preview-error');
    const previewError = (message, code = 50001) => Object.assign(new Error(message), { [errorCode]: code });

    const checkedSize = (value) => {
      if (!Number.isSafeInteger(value) || value < 0) throw previewError('Invalid image file size.');
      if (value > maxBytes) throw previewError('Image preview exceeds the 32 MiB limit.', 41302);
      return value;
    };

    const downloadSize = (response, originalSize) => {
      const length = response.headers.get('content-length');
      if (length === null) return originalSize;
      if (!/^\d+$/.test(length)) throw previewError('Invalid image download length.');
      const size = checkedSize(Number(length));
      if (originalSize !== null && size !== originalSize) throw previewError('Image download length does not match the file.');
      return size;
    };

    const collectBytes = async (reader, expectedSize, cancellation) => {
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await Promise.race([reader.read(), cancellation]);
        if (done) break;
        total = checkedSize(total + value.byteLength);
        if (expectedSize !== null && total > expectedSize) throw previewError('Image download is longer than expected.');
        chunks.push(value);
      }
      if (total === 0) throw previewError('Image download is empty.');
      if (expectedSize !== null && total !== expectedSize) throw previewError('Image download is incomplete.');
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    };

    const boundedBytes = async (response, expectedSize, signal) => {
      signal?.throwIfAborted();
      if (response.body === null) throw previewError('Image download has no body.');
      const reader = response.body.getReader();
      let abortRead;
      const aborted = new Promise((_, reject) => { abortRead = reject; });
      const onAbort = () => {
        abortRead(signal.reason);
        void reader.cancel().catch(() => {});
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const bytes = await collectBytes(reader, expectedSize, aborted);
        signal?.throwIfAborted();
        return bytes;
      } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        reader.releaseLock();
      }
    };

    const base64Content = (bytes) => {
      const parts = [];
      for (let offset = 0; offset < bytes.byteLength; offset += 24576) {
        parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
      }
      return parts.join('');
    };

    const downloadHeaders = (headers) => {
      const result = new Headers();
      headers.forEach((value, name) => {
        if (name === 'authorization' || name.startsWith('x-kimi-')) result.set(name, value);
      });
      return result;
    };

    const downloadMime = (response, file) => {
      if (response.status !== 200 || response.redirected) throw previewError('Image download did not return a complete file.');
      if (response.url && new URL(response.url).origin !== location.origin) {
        throw previewError('Image download left this site.');
      }
      const mime = imageMime(response.headers.get('content-type'));
      if (mime === null) throw previewError('Image download did not return an image.');
      if (file !== null && mime !== imageMime(file.mime)) throw previewError('Image download type changed.');
      return mime;
    };

    const downloadImage = async (request, metadata, fetchOptions, receiver) => {
      const originalSize = metadata.file === null ? null : checkedSize(metadata.file.size);
      const response = await nativeFetch.call(receiver, request.downloadUrl, {
        method: 'GET',
        headers: downloadHeaders(request.headers),
        redirect: 'error',
        ...fetchOptions,
      });
      try {
        const mime = downloadMime(response, metadata.file);
        const expectedSize = downloadSize(response, originalSize);
        if (expectedSize === null) throw previewError('Image download is missing its file length.');
        const bytes = await boundedBytes(response, expectedSize, fetchOptions.signal);
        fetchOptions.signal?.throwIfAborted();
        const file = metadata.file ?? {
          path: request.options.path,
          encoding: 'base64',
          etag: response.headers.get('etag') ?? '',
          is_binary: mime !== 'image/svg+xml',
        };
        return { ...file, content: base64Content(bytes), mime, size: bytes.byteLength, truncated: false };
      } catch (error) {
        void response.body?.cancel().catch(() => {});
        throw error;
      }
    };

    const jsonResponse = (response, envelope, status = response.status) => {
      const headers = new Headers(response.headers);
      for (const name of ['content-length', 'content-encoding', 'etag', 'content-md5', 'digest', 'transfer-encoding']) {
        headers.delete(name);
      }
      headers.set('content-type', 'application/json');
      return new Response(JSON.stringify(envelope), {
        status,
        statusText: status === response.status ? response.statusText : 'OK',
        headers,
      });
    };

    const failedEnvelope = (envelope, error) => ({
      ...envelope,
      code: error?.[errorCode] === 41302 ? 41302 : 50001,
      msg: `Image preview failed: ${error?.[errorCode] ? error.message : 'Could not download the complete image.'}`,
      data: null,
    });

    window.fetch = async function imagePreviewFetch(input, init) {
      const request = await readRequest(input, init);
      const response = await nativeFetch.call(this, input, init);
      if (request === null) return response;
      const metadata = await readMetadata(response, request);
      if (metadata === null) return response;
      const signal = requestOption(input, init, 'signal');
      try {
        signal?.throwIfAborted();
        const file = await downloadImage(request, metadata, {
          signal,
          credentials: requestOption(input, init, 'credentials', 'same-origin'),
        }, this);
        return jsonResponse(response, { ...metadata.envelope, code: 0, msg: 'success', data: file }, 200);
      } catch (error) {
        signal?.throwIfAborted();
        if (error?.name === 'AbortError') throw error;
        return jsonResponse(response, failedEnvelope(metadata.envelope, error));
      }
    };
  }
}
