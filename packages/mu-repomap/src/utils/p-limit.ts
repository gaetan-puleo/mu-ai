type Task<T> = () => Promise<T>;

export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const run = queue.shift();
      run?.();
    }
  }

  return <T>(fn: Task<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(
          (val) => {
            active--;
            resolve(val);
            next();
          },
          (err) => {
            active--;
            reject(err);
            next();
          },
        );
      };

      if (active < concurrency) {
        active++;
        run();
      } else {
        queue.push(run);
      }
    });
  };
}
