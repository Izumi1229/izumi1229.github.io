import fs from "node:fs/promises";
import path from "node:path";

const lockPath = path.join(
  process.cwd(),
  ".git-operation.lock"
);

const wait = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function removeStaleLock() {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const lock = JSON.parse(raw);

    if (isProcessAlive(Number(lock.pid))) return false;

    const current = await fs.readFile(lockPath, "utf8");
    if (current !== raw) return false;

    await fs.unlink(lockPath);
    console.log("🧹 已清理失效的 Git 锁文件。");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return true;

    // 文件可能正在创建，稍后再检查，避免误删有效锁。
    return false;
  }
}

export async function withGitLock(task, options = {}) {
  const timeout = options.timeout ?? 120000;
  const retryInterval = options.retryInterval ?? 500;
  const startedAt = Date.now();

  let handle;

  while (!handle) {
    try {
      handle = await fs.open(lockPath, "wx");

      try {
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }));
      } catch (error) {
        await handle.close().catch(() => {});
        handle = undefined;
        await fs.unlink(lockPath).catch(() => {});
        throw error;
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      await removeStaleLock();

      if (Date.now() - startedAt >= timeout) {
        throw new Error(
          "等待 Git 操作锁超时，请检查是否有其他发布任务正在运行。"
        );
      }

      await wait(retryInterval);
    }
  }

  try {
    return await task();
  } finally {
    await handle.close();
    await fs.unlink(lockPath).catch(() => {});
  }
}
