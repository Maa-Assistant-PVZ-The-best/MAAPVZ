#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pvz_android.py
适配安卓端的python环境
"""

import json
import os
import re
import shutil
import signal
import socket
import sys
import time

from flask import Flask, jsonify, request, send_from_directory

# 以脚本所在目录为基准
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# 项目根 = endless_setup/../..;可用环境变量 MAAPVZ_DIR 覆盖
PROJECT_DIR = os.environ.get("MAAPVZ_DIR", os.path.dirname(os.path.dirname(BASE_DIR)))


def _pick_resource_dir():
    """定位资源根目录，与 agent/jobset/engine.py 的 _pick_resource_dir 保持同一口径。

    - 发行包：<根>/resource/ 存在（MaaFramework 正式资源目录）-> 用它
    - 开发仓库：没有 <根>/resource/ -> 用 <根>/assets/resource/
    """
    packaged = os.path.join(PROJECT_DIR, "resource")
    if os.path.isdir(packaged):
        return packaged
    return os.path.join(PROJECT_DIR, "assets", "resource")


def _is_android():
    """是否跑在安卓端（与 agent/jobset/engine.py 的 _is_android 同一口径）。"""
    return (
        os.environ.get("MAA_JOB_EDITOR_ANDROID") == "1"
        or "ANDROID_ROOT" in os.environ
        or "ANDROID_DATA" in os.environ
        or (sys.platform.startswith("linux")
            and os.path.isfile("/system/build.prop"))
    )


def _jobs_dir_for(root, android=False):
    """作业集目录（用户数据）—— 与 agent/jobset/engine.py 的 jobs_dir_for 同一口径。

    ★ 必须落在「更新不会整棵替换」的位置，否则用户更新一次作业集就被清空：
      - 安卓（root = pi 解包树）：root/../jobs
        App 升级只整体替换包里带的根级条目（resource/、agent/ …），
        「设置里重新解压资源」更会整棵 pi 删了重解 —— 同级目录才活得下来。
      - 桌面发行包：root/jobs（包里没有 jobs/，差分更新不会动它）
      - 开发仓库：root/assets/resource/jobs（.gitignore 已排除）
    """
    if android:
        return os.path.join(os.path.dirname(os.path.abspath(root)), "jobs")
    if os.path.isdir(os.path.join(root, "resource")):
        return os.path.join(root, "jobs")
    return os.path.join(root, "assets", "resource", "jobs")


RESOURCE_DIR = _pick_resource_dir()
# 作业集目录；agent 端算法与此一致
JOBS_DIR = _jobs_dir_for(PROJECT_DIR, _is_android())
# 历史布局的作业集位置（老用户数据可能还躺在这儿，启动时迁到 JOBS_DIR）。
# 顺序 = 新 -> 旧。
LEGACY_JOBS_DIRS = [
    os.path.join(PROJECT_DIR, "resource", "jobs"),             # 2026-09-30 ~ 2026-10-30
    os.path.join(PROJECT_DIR, "assets", "resource", "jobs"),   # 更早
]

app = Flask(__name__, static_folder=STATIC_DIR)
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")


# 下面和pvz.py一样


@app.after_request
def _no_cache(resp):
    """静态资源一律禁缓存。"""
    resp.headers["Cache-Control"] = "no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    return resp


def ensure_jobs_dir():
    os.makedirs(JOBS_DIR, exist_ok=True)


def migrate_legacy_jobs():
    """把历史布局里的作业集搬到 JOBS_DIR（目标已有同名文件时不覆盖）。"""
    moved = 0
    for legacy in LEGACY_JOBS_DIRS:
        if os.path.normpath(legacy) == os.path.normpath(JOBS_DIR):
            continue
        if not os.path.isdir(legacy):
            continue
        for name in sorted(os.listdir(legacy)):
            if not name.endswith(".json"):
                continue
            src = os.path.join(legacy, name)
            dst = os.path.join(JOBS_DIR, name)
            if not os.path.isfile(src) or os.path.exists(dst):
                continue
            try:
                os.makedirs(JOBS_DIR, exist_ok=True)
                shutil.move(src, dst)
                moved += 1
            except OSError:
                continue
    return moved


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/save_config", methods=["POST"])
def save_config():
    try:
        data = request.get_json()
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return jsonify({"status": "success", "msg": "已保存"})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500


# ================= 作业集（JobSet）API =================

# ---- 选卡模板目录（/plants 据此标注「无图植物 / 缺超装」）----
PLANT_CARD_DIR = os.path.join(
    RESOURCE_DIR, "image", "General", "plant", "plant_ref_card"
)
PLANT_ENDLESS_DIR = os.path.join(
    RESOURCE_DIR, "image", "General", "plant", "plant_ref_endless"
)
PLANT_QUALITY_FOLDER = {
    "橙": "orange_card",
    "紫": "purple_card",
    "蓝": "blue_card",
    "绿": "green_card",
    "白": "white_card",
}


def _scan_plant_dir(root):
    out = {}
    if not os.path.isdir(root):
        return out
    for q, folder in PLANT_QUALITY_FOLDER.items():
        qdir = os.path.join(root, folder)
        info = {"flat": set(), "subs": {}}
        if os.path.isdir(qdir):
            for name in os.listdir(qdir):
                p = os.path.join(qdir, name)
                if os.path.isfile(p) and name.lower().endswith(".png"):
                    info["flat"].add(name[:-4])
                elif os.path.isdir(p):
                    cnt = sum(
                        1
                        for f in os.listdir(p)
                        if f.lower().endswith(".png")
                        and os.path.isfile(os.path.join(p, f))
                    )
                    info["subs"][name] = cnt
        out[q] = info
    return out


def _dir_has_img(info, en):
    if not en:
        return False
    if en in info.get("flat", set()):
        return True
    sub_cnt = info.get("subs", {}).get(en)
    return sub_cnt is not None and sub_cnt >= 1


@app.route("/plants", methods=["GET"])
def list_plants():
    try:
        with open(os.path.join(STATIC_DIR, "plants.json"), encoding="utf-8") as f:
            plants = json.load(f)
        scan = _scan_plant_dir(PLANT_CARD_DIR)
        scan_e = _scan_plant_dir(PLANT_ENDLESS_DIR)
        for pl in plants:
            rarity = str(pl.get("rarity", "")).strip()
            en = str(pl.get("en") or "").strip()
            info = scan.get(rarity) or {}
            pl["has_img"] = _dir_has_img(info, en)
            sub_cnt = info.get("subs", {}).get(en)
            if sub_cnt is None:
                pl["super"] = "none"
                pl["super_count"] = 0
            elif sub_cnt >= 2:
                pl["super"] = "collected"
                pl["super_count"] = sub_cnt - 1
            else:
                pl["super"] = "missing"
                pl["super_count"] = 0
            pl["has_img_endless"] = _dir_has_img(scan_e.get(rarity) or {}, en)
        return jsonify({"status": "success", "plants": plants})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500


# ---- 神器识别图目录 ----
GOD_VESSEL_DIR = os.path.join(RESOURCE_DIR, "image", "General", "god_vessel")


@app.route("/artifacts", methods=["GET"])
def list_artifacts():
    try:
        with open(os.path.join(STATIC_DIR, "artifacts.json"), encoding="utf-8") as f:
            arts = json.load(f)
        for a in arts:
            en = str(a.get("en") or "").strip()
            adir = os.path.join(GOD_VESSEL_DIR, en)
            has = False
            if en and os.path.isdir(adir):
                has = any(
                    fn.lower().endswith(".png")
                    and os.path.isfile(os.path.join(adir, fn))
                    for fn in os.listdir(adir)
                )
            a["has_img"] = has
            bdir = os.path.join(adir, "bodytype")
            bts = []
            if os.path.isdir(bdir):
                bts = sorted(
                    fn[:-4]
                    for fn in os.listdir(bdir)
                    if fn.lower().endswith(".png")
                    and os.path.isfile(os.path.join(bdir, fn))
                )
            a["bodytypes"] = bts
        return jsonify({"status": "success", "artifacts": arts})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500


COORDS_FILE = os.path.join(PROJECT_DIR, "agent", "assets", "resource", "coords.json")


@app.route("/coords", methods=["GET"])
def list_coords():
    try:
        with open(COORDS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            data = {}
        return jsonify({"status": "success", "coords": data})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e), "coords": {}}), 500


@app.route("/list_jobs", methods=["GET"])
def list_jobs():
    ensure_jobs_dir()
    current = ""
    cur_path = os.path.join(JOBS_DIR, "current.json")
    if os.path.exists(cur_path):
        try:
            with open(cur_path, encoding="utf-8") as f:
                current = str(json.load(f).get("code", ""))
        except Exception:
            current = ""
    jobs = []
    for name in sorted(os.listdir(JOBS_DIR)):
        if not name.endswith(".json") or name == "current.json":
            continue
        code = name[:-5]
        entry = {"code": code, "current": (code == current)}
        try:
            with open(os.path.join(JOBS_DIR, name), encoding="utf-8") as f:
                d = json.load(f)
            entry["name"] = d.get("name", "")
            entry["version"] = d.get("version", "")
            entry["tables"] = len(d.get("tables", []) or [])
        except Exception:
            pass
        jobs.append(entry)
    return jsonify({"status": "success", "jobs": jobs, "current": current})


def _compile_jobset(data):
    """调 agent.jobset.compile.compile_jobset，打印编译摘要到服务器日志。"""
    if PROJECT_DIR not in sys.path:
        sys.path.insert(0, PROJECT_DIR)
    from agent.jobset.compile import compile_jobset

    print("[compile] 开始编译作业集...", flush=True)
    out = compile_jobset(data, log=lambda m: print(f"[compile] {m}", flush=True))
    print("[compile] 完成", flush=True)
    return out


@app.route("/save_job", methods=["POST"])
def save_job():
    try:
        data = request.get_json()
        code = str(data.get("code", "")).strip()
        if not code or not re.fullmatch(r"[A-Za-z0-9_-]+", code):
            return (
                jsonify({"status": "error", "msg": "作业集代码不合法（仅字母数字_-）"}),
                400,
            )
        try:
            data = _compile_jobset(data)
        except Exception as ce:
            import traceback

            traceback.print_exc()
            return (
                jsonify({"status": "error", "msg": f"作业集编译失败（未保存）: {ce}"}),
                500,
            )
        ensure_jobs_dir()
        with open(os.path.join(JOBS_DIR, code + ".json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify(
            {"status": "success", "msg": "已保存作业集 " + code + "（含预编译）"}
        )
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500


@app.route("/load_job", methods=["GET"])
def load_job():
    code = str(request.args.get("code", "")).strip()
    if not code or not re.fullmatch(r"[A-Za-z0-9_-]+", code):
        return jsonify({"status": "error", "msg": "作业集代码不合法"}), 400
    ensure_jobs_dir()
    path = os.path.join(JOBS_DIR, code + ".json")
    if not os.path.exists(path):
        return jsonify({"status": "error", "msg": "作业集不存在: " + code}), 404
    try:
        with open(path, encoding="utf-8") as f:
            job = json.load(f)
        return jsonify({"status": "success", "job": job})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500


@app.route("/delete_job", methods=["POST"])
def delete_job():
    try:
        data = request.get_json()
        code = str(data.get("code", "")).strip()
        if not code or not re.fullmatch(r"[A-Za-z0-9_-]+", code):
            return jsonify({"status": "error", "msg": "作业集代码不合法"}), 400
        ensure_jobs_dir()
        path = os.path.join(JOBS_DIR, code + ".json")
        if not os.path.exists(path):
            return jsonify({"status": "error", "msg": "作业集不存在: " + code}), 404
        os.remove(path)
        cur_path = os.path.join(JOBS_DIR, "current.json")
        cleared = False
        if os.path.exists(cur_path):
            try:
                with open(cur_path, encoding="utf-8") as f:
                    if str(json.load(f).get("code", "")) == code:
                        with open(cur_path, "w", encoding="utf-8") as w:
                            json.dump({"code": ""}, w, ensure_ascii=False)
                        cleared = True
            except Exception:
                pass
        msg = "已删除作业集 " + code + ("（同时清空当前作业集）" if cleared else "")
        return jsonify({"status": "success", "msg": msg})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500


@app.route("/set_current_job", methods=["POST"])
def set_current_job():
    try:
        data = request.get_json()
        code = str(data.get("code", "")).strip()
        ensure_jobs_dir()
        with open(os.path.join(JOBS_DIR, "current.json"), "w", encoding="utf-8") as f:
            json.dump({"code": code}, f, ensure_ascii=False)
        return jsonify({"status": "success", "msg": "已设为当前作业集 " + code})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500


@app.route("/shutdown", methods=["POST"])
def shutdown():
    import threading

    threading.Timer(0.4, os._exit, args=(0,)).start()
    return jsonify({"status": "success", "msg": "后端进程已关闭"})


# ============================================================
# PID 文件与端口接管（Android / POSIX 版）
# ============================================================


def _pidfile_path() -> str:
    env = os.environ.get("MAA_PVZ_EDITOR_PIDFILE")
    if env:
        return env
    home = os.environ.get("HOME")
    if home:
        return os.path.join(home, ".maapvz_pvz_editor.pid")
    return os.path.join(BASE_DIR, ".maapvz_pvz_editor.pid")


PID_FILE = _pidfile_path()
MY_ROOT = os.path.dirname(os.path.abspath(__file__))


def _read_pid_file():
    """-> (pid, root)；旧格式只有 pid 时 root=None。"""
    try:
        with open(PID_FILE, "r", encoding="utf-8") as f:
            parts = f.read().strip().split("|", 1)
        pid = int(parts[0])
        root = parts[1] if len(parts) > 1 else None
        return pid, root
    except Exception:
        return None, None


def _write_pid_file():
    try:
        with open(PID_FILE, "w", encoding="utf-8") as f:
            f.write(f"{os.getpid()}|{MY_ROOT}")
    except Exception as e:
        # 与 pvz.py 一致：警告里不要带 emoji，GBK 控制台 encode 不了
        print(f"[pvz] !! PID 标记文件写入失败（{PID_FILE}）：{e}", flush=True)


def _pid_alive(pid: int) -> bool:
    """os.kill(pid, 0) 判活；PermissionError 视为活着（不同 uid）。"""
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except Exception:
        return False


def _pid_cmdline(pid: int) -> str:
    """读 /proc/<pid>/cmdline（Linux/Android 通用）。"""
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return (
                f.read().replace(b"\0", b" ").decode("utf-8", errors="replace").strip()
            )
    except Exception:
        return ""


def _looks_like_editor(pid: int) -> bool:
    """PID 文件可能指向被系统复用的 PID；/proc 校验避免误杀无关进程。"""
    cmd = _pid_cmdline(pid)
    if not cmd:
        # /proc 不可读（权限或非 Linux）：保守视为编辑器
        return True
    low = cmd.lower()
    return any(tag in low for tag in ("pvz.py", "pvz_android.py", "endless_setup"))


def _kill_and_wait(
    pid: int, try_bind, sigterm_wait: float = 5.0, sigkill_wait: float = 3.0
) -> bool:
    """SIGTERM 等 sigterm_wait；不走就 SIGKILL 再等 sigkill_wait。

    成功让端口释放返回 True；否则 False。
    """
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return try_bind()
    except PermissionError:
        print(f"[pvz] 无权限 SIGTERM {pid}（不同 uid），跳过", flush=True)
        return try_bind()
    except Exception as e:
        print(f"[pvz] SIGTERM {pid} 失败: {e}", flush=True)

    deadline = time.time() + sigterm_wait
    while time.time() < deadline:
        if try_bind():
            return True
        time.sleep(0.2)

    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return try_bind()
    except PermissionError:
        print(f"[pvz] 无权限 SIGKILL {pid}（不同 uid）", flush=True)
        return try_bind()
    except Exception as e:
        print(f"[pvz] SIGKILL {pid} 失败: {e}", flush=True)

    deadline = time.time() + sigkill_wait
    while time.time() < deadline:
        if try_bind():
            return True
        time.sleep(0.2)
    return False


def _ensure_port_free(host: str, port: int, reuse: bool = False) -> None:
    """启动前确认端口可用；被占时按「自己人」规则接管或复用。

    Android 版：
      - 端口空闲 -> 直接返回
      - 端口被占：
        · PID 文件记录在案、进程活着、/proc 校验通过、--reuse 且同根目录
          -> 退出 0（复用）
        · PID 文件记录在案、进程活着、/proc 校验通过、其他情况
          -> SIGTERM → SIGKILL 接管
        · 无 PID 记录 / 进程已死 / 校验不过
          -> 不猜测，报错退出（需手动处理）
    """

    def _try_bind() -> bool:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False
        finally:
            s.close()

    if _try_bind():
        return

    recorded, recorded_root = _read_pid_file()

    if recorded is not None and _pid_alive(recorded):
        if not _looks_like_editor(recorded):
            print(
                f"[pvz] PID {recorded} 已不是编辑器进程（可能 PID 复用），不杀。",
                flush=True,
            )
            print(f"       请手动处理：找到监听 {port} 的进程并 kill", flush=True)
            sys.exit(2)

        if (
            reuse
            and recorded_root
            and os.path.normcase(recorded_root) == os.path.normcase(MY_ROOT)
        ):
            print(f"[pvz] 服务已在运行（PID {recorded}），复用", flush=True)
            sys.exit(0)

        print(
            f"[pvz] 端口 {port} 被上一个编辑器实例占用（PID {recorded}），关闭它以接管",
            flush=True,
        )
        if _kill_and_wait(recorded, _try_bind):
            return
        print(f"[致命] 已关闭旧实例但端口 {port} 仍未释放，启动失败", flush=True)
        sys.exit(2)

    print(
        f"[致命] 端口 {port} 被未知进程占用（PID 文件未记录或进程已退出），不自动杀。",
        flush=True,
    )
    print(f"       请手动处理：找到监听 {port} 的进程并 kill", flush=True)
    sys.exit(2)


if __name__ == "__main__":
    # 历史布局：<根>/resource/jobs（2026-09-30 起误放进资源目录）与
    # <根>/assets/resource/jobs。启动时迁到包外的新位置（安卓是 <pi>/../jobs，
    # 升级不会整棵替换），避免用户作业集被清空后无处可搬。
    try:
        _moved = migrate_legacy_jobs()
        if _moved:
            print(f"[jobset] 已从旧目录迁移 {_moved} 个作业集 -> {JOBS_DIR}")
    except Exception as _e:
        print(f"[jobset] 旧作业集迁移失败（不影响启动）: {_e}")

    _ensure_port_free("127.0.0.1", 5000, reuse=("--reuse" in sys.argv))
    _write_pid_file()
    # threaded=True：保存作业集要编译，单线程会阻塞 /save_job 之后的请求
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False, threaded=True)
