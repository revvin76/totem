// Nonblocking, bounded timer queries; disjoint GPU results are discarded.
export function createGpuTimer(gl) {
  const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [], samples = [];
  let current = null;
  return {
    samples,
    supported: Boolean(extension),
    begin(onComplete) {
      if (!extension || current || gl.isContextLost()) return;
      const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
      for (let i = pending.length - 1; i >= 0; i--) {
        const { query, complete } = pending[i];
        if (!disjoint && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
        if (!disjoint) {
          const elapsed = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
          samples.push(elapsed);
          if (samples.length > 512) samples.shift();
          complete?.(elapsed);
        }
        gl.deleteQuery(query); pending.splice(i, 1);
      }
      if (disjoint || pending.length >= 4) return;
      const query = gl.createQuery();
      if (!query) return;
      current = { query, complete: onComplete };
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
    },
    end() {
      if (!current) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pending.push(current); current = null;
    },
    dispose() {
      if (current) { gl.endQuery(extension.TIME_ELAPSED_EXT); gl.deleteQuery(current.query); current = null; }
      for (const { query } of pending.splice(0)) gl.deleteQuery(query);
    },
  };
}
