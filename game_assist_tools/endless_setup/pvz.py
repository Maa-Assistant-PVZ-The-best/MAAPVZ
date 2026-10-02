from flask import Flask, request, jsonify, send_from_directory
import os, json, re, shutil, sys

# 以脚本所在目录为基准（保持成熟版 static/ 结构；用绝对路径，便于 agent 直接拉起而无需 cd）
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')

# 项目根 = endless_setup/../..（即仓库根）；可用环境变量 MAAPVZ_DIR 覆盖
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


RESOURCE_DIR = _pick_resource_dir()
# 作业集目录（网页保存 + agent 运行时读取）；agent 端算法与此一致
JOBS_DIR = os.path.join(RESOURCE_DIR, "jobs")
# 旧版布局的作业集位置（老用户数据在这里，需要迁移）
LEGACY_JOBS_DIR = os.path.join(PROJECT_DIR, "assets", "resource", "jobs")

app = Flask(__name__, static_folder=STATIC_DIR)
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')


@app.after_request
def _no_cache(resp):
    """静态资源一律禁缓存。

    这是开发/配置工具：JS 改动后用户只需要刷新页面就能拿到新代码。
    之前没这个头，浏览器启发式缓存导致「改了 JS 但页面还在跑旧代码」，
    保存出来的作业集 JSON 用的还是旧导出逻辑（表2 boss 链沿用表1 的 bug
    就是这样被旧代码又写回去的）。
    """
    resp.headers['Cache-Control'] = 'no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    return resp


def ensure_jobs_dir():
    os.makedirs(JOBS_DIR, exist_ok=True)


def migrate_legacy_jobs():
    """把旧布局 <根>/assets/resource/jobs 里的作业集搬到新位置。

    只在两个目录确实不同时才做（开发仓库里相同 -> 直接跳过）。
    目标已有同名文件时不覆盖（新位置优先）。
    """
    if os.path.normpath(LEGACY_JOBS_DIR) == os.path.normpath(JOBS_DIR):
        return 0
    if not os.path.isdir(LEGACY_JOBS_DIR):
        return 0
    moved = 0
    for name in sorted(os.listdir(LEGACY_JOBS_DIR)):
        if not name.endswith('.json'):
            continue
        src = os.path.join(LEGACY_JOBS_DIR, name)
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


@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'index.html')


@app.route('/save_config', methods=['POST'])
def save_config():
    try:
        data = request.get_json()
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return jsonify({'status': 'success', 'msg': '已保存'})
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500


# ================= 作业集（JobSet）API =================

# ---- 选卡模板目录（/plants 据此标注「无图植物 / 缺超装」）----
# 与 agent/select_plant/plant_lib.py 的 QUALITY_FOLDER 同一口径（英文目录名）。
PLANT_CARD_DIR = os.path.join(RESOURCE_DIR, "image", "General", "plant", "plant_ref_card")
# 无尽局外 80 选卡的模板目录（手截图，只有平铺，无皮肤夹）
PLANT_ENDLESS_DIR = os.path.join(RESOURCE_DIR, "image", "General", "plant", "plant_ref_endless")
PLANT_QUALITY_FOLDER = {"橙": "orange_card", "紫": "purple_card", "蓝": "blue_card",
                        "绿": "green_card", "白": "white_card"}


def _scan_plant_dir(root):
    """扫一个植物模板目录：{品质: {"flat": {英文名,...}, "subs": {英文名: png数}}}

    - flat：平铺单模板 <品质目录>/<英文名>.png
    - subs：皮肤子文件夹 <品质目录>/<英文名>/ 里的 png 数量
      （1 张 = 只有基础卡、缺超装图；>=2 张 = 超装已收集；不存在 = 该植物无超装）
    每次请求现扫（目录很小，且用户会手动增删截图，不能缓存）。
    """
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
                    cnt = sum(1 for f in os.listdir(p)
                              if f.lower().endswith(".png")
                              and os.path.isfile(os.path.join(p, f)))
                    info["subs"][name] = cnt
        out[q] = info
    return out


def _dir_has_img(info, en):
    """单个目录的判定：平铺或皮肤夹里有图即算有。"""
    if not en:
        return False
    if en in info.get("flat", set()):
        return True
    sub_cnt = info.get("subs", {}).get(en)
    return sub_cnt is not None and sub_cnt >= 1


@app.route('/plants', methods=['GET'])
def list_plants():
    """返回植物列表（槽位选植物面板用）：中文名 / 品质 / 头像 URL

    ★ 附带模板目录实况（网页端据此打叉禁选 + 悬停提示）：
      - has_img / super：plant_ref_card（局内 8 槽选卡）实况，
        super = 'none'（无皮肤夹）/ 'missing'（缺超装图）/ 'collected'（超装已收集）
      - has_img_endless：plant_ref_endless（无尽局外 80 选卡）有没有图
    """
    try:
        with open(os.path.join(STATIC_DIR, 'plants.json'), encoding='utf-8') as f:
            plants = json.load(f)
        scan = _scan_plant_dir(PLANT_CARD_DIR)
        scan_e = _scan_plant_dir(PLANT_ENDLESS_DIR)
        for pl in plants:
            rarity = str(pl.get("rarity", "")).strip()
            en = str(pl.get("en") or "").strip()
            info = scan.get(rarity) or {}
            pl["has_img"] = _dir_has_img(info, en)
            sub_cnt = info.get("subs", {}).get(en)   # None = 无皮肤夹
            if sub_cnt is None:
                pl["super"] = "none"
            elif sub_cnt >= 2:
                pl["super"] = "collected"
            else:
                pl["super"] = "missing"
            pl["has_img_endless"] = _dir_has_img(scan_e.get(rarity) or {}, en)
        return jsonify({'status': 'success', 'plants': plants})
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500


@app.route('/list_jobs', methods=['GET'])
def list_jobs():
    """列出本地作业集（含 current 标记）"""
    ensure_jobs_dir()
    current = ''
    cur_path = os.path.join(JOBS_DIR, 'current.json')
    if os.path.exists(cur_path):
        try:
            with open(cur_path, encoding='utf-8') as f:
                current = str(json.load(f).get('code', ''))
        except Exception:
            current = ''
    jobs = []
    for name in sorted(os.listdir(JOBS_DIR)):
        if not name.endswith('.json') or name == 'current.json':
            continue
        code = name[:-5]
        entry = {'code': code, 'current': (code == current)}
        try:
            with open(os.path.join(JOBS_DIR, name), encoding='utf-8') as f:
                d = json.load(f)
            entry['name'] = d.get('name', '')
            entry['version'] = d.get('version', '')
            entry['worlds'] = d.get('worlds', [])
            entry['tables'] = len(d.get('tables', []) or [])
        except Exception:
            pass
        jobs.append(entry)
    return jsonify({'status': 'success', 'jobs': jobs, 'current': current})


@app.route('/save_job', methods=['POST'])
def save_job():
    """保存作业集 JSON 到 jobs/<code>.json

    ★ 保存时预编译（「HTML 一次编译好」）：写入文件前给每张表生成
      compiled.normal / compiled.boss —— 完整 override 字典，运行时
      直接 override_pipeline() 零翻译。编译器是 agent/jobset/compile.py
      的纯函数（无 maa 依赖，本服务器可直接 import）。
      编译失败 -> 报错且不保存：静默保存未编译 JSON 会让 runtime 走
      回退编译，格式漂移就藏住了。
    """
    try:
        data = request.get_json()
        code = str(data.get('code', '')).strip()
        if not code or not re.fullmatch(r'[A-Za-z0-9_-]+', code):
            return jsonify({'status': 'error', 'msg': '作业集代码不合法（仅字母数字_-）'}), 400
        try:
            data = _compile_jobset(data)
        except Exception as ce:
            import traceback
            traceback.print_exc()
            return jsonify({'status': 'error',
                            'msg': f'作业集编译失败（未保存）: {ce}'}), 500
        ensure_jobs_dir()
        with open(os.path.join(JOBS_DIR, code + '.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({'status': 'success', 'msg': '已保存作业集 ' + code + '（含预编译）'})
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500


def _compile_jobset(data):
    """调 agent.jobset.compile.compile_jobset，打印编译摘要到服务器日志。"""
    if PROJECT_DIR not in sys.path:
        sys.path.insert(0, PROJECT_DIR)
    from agent.jobset.compile import compile_jobset
    print('[compile] 开始编译作业集...', flush=True)
    out = compile_jobset(data, log=lambda m: print(f'[compile] {m}', flush=True))
    print('[compile] 完成', flush=True)
    return out


@app.route('/load_job', methods=['GET'])
def load_job():
    """读取单个作业集的完整 JSON（供网页「选择作业集」把内容载回棋盘）"""
    code = str(request.args.get('code', '')).strip()
    if not code or not re.fullmatch(r'[A-Za-z0-9_-]+', code):
        return jsonify({'status': 'error', 'msg': '作业集代码不合法'}), 400
    ensure_jobs_dir()
    path = os.path.join(JOBS_DIR, code + '.json')
    if not os.path.exists(path):
        return jsonify({'status': 'error', 'msg': '作业集不存在: ' + code}), 404
    try:
        with open(path, encoding='utf-8') as f:
            job = json.load(f)
        return jsonify({'status': 'success', 'job': job})
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500


@app.route('/delete_job', methods=['POST'])
def delete_job():
    """删除 jobs/<code>.json；若它正是 current，则一并把 current 清掉"""
    try:
        data = request.get_json()
        code = str(data.get('code', '')).strip()
        if not code or not re.fullmatch(r'[A-Za-z0-9_-]+', code):
            return jsonify({'status': 'error', 'msg': '作业集代码不合法'}), 400
        ensure_jobs_dir()
        path = os.path.join(JOBS_DIR, code + '.json')
        if not os.path.exists(path):
            return jsonify({'status': 'error', 'msg': '作业集不存在: ' + code}), 404
        os.remove(path)
        # 若删掉的正是「当前作业集」，清空 current.json，避免指向不存在的文件
        cur_path = os.path.join(JOBS_DIR, 'current.json')
        cleared = False
        if os.path.exists(cur_path):
            try:
                with open(cur_path, encoding='utf-8') as f:
                    if str(json.load(f).get('code', '')) == code:
                        with open(cur_path, 'w', encoding='utf-8') as w:
                            json.dump({'code': ''}, w, ensure_ascii=False)
                        cleared = True
            except Exception:
                pass
        msg = '已删除作业集 ' + code + ('（同时清空当前作业集）' if cleared else '')
        return jsonify({'status': 'success', 'msg': msg})
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500


@app.route('/set_current_job', methods=['POST'])
def set_current_job():
    """写 jobs/current.json = {"code": ...}（供 agent「使用本地作业集」读取）"""
    try:
        data = request.get_json()
        code = str(data.get('code', '')).strip()
        ensure_jobs_dir()
        with open(os.path.join(JOBS_DIR, 'current.json'), 'w', encoding='utf-8') as f:
            json.dump({'code': code}, f, ensure_ascii=False)
        return jsonify({'status': 'success', 'msg': '已设为当前作业集 ' + code})
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500


def _ensure_port_free(host: str, port: int) -> None:
    """启动前确认端口空闲，被占用就直接退出（大声报错）。

    ★ 为什么需要：Werkzeug 开发服务器默认带 SO_REUSEADDR，而在 Windows 上
      这个标志允许**多个进程同时绑同一个端口**——后启动的实例显示
      "Running on http://127.0.0.1:5000"，其实收不到任何请求，
      请求全被最先绑定的旧进程吃掉。
      实际踩过：旧服务器（改代码前启动的）一直占着 5000，
      用户反复重启 pvz.bat 都「成功启动」但保存作业集时跑的还是旧逻辑。

    检查用**不带** SO_REUSEADDR 的裸 bind：端口被占时必然失败。
    """
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind((host, port))
    except OSError:
        print(f"[致命] 端口 {port} 已被占用 —— 很可能已经有一个 pvz.py 在运行！", flush=True)
        print("       旧进程会吃掉所有请求（本进程启动了也收不到）。", flush=True)
        print("       请先关掉旧进程：netstat -ano | findstr :5000 查 PID 后 taskkill /PID <pid> /F", flush=True)
        sys.exit(2)
    finally:
        s.close()


if __name__ == '__main__':
    # 老版本把作业集放在 <根>/assets/resource/jobs，新版改到资源目录下。
    # 这里迁移一次，避免老用户升级后作业集「消失」。
    try:
        _moved = migrate_legacy_jobs()
        if _moved:
            print(f"[jobset] 已从旧目录迁移 {_moved} 个作业集 -> {JOBS_DIR}")
    except Exception as _e:
        print(f"[jobset] 旧作业集迁移失败（不影响启动）: {_e}")

    # 保持成熟版端口 5000；关闭 reloader，便于被 bat / agent 以后台进程拉起后稳定存活
    _ensure_port_free("127.0.0.1", 5000)
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
