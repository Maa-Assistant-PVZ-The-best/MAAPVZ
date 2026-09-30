from flask import Flask, request, jsonify, send_from_directory
import os, json, re, shutil

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

@app.route('/plants', methods=['GET'])
def list_plants():
    """返回植物列表（槽位选植物面板用）：中文名 / 品质 / 头像 URL"""
    try:
        with open(os.path.join(STATIC_DIR, 'plants.json'), encoding='utf-8') as f:
            plants = json.load(f)
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
    """保存作业集 JSON 到 jobs/<code>.json"""
    try:
        data = request.get_json()
        code = str(data.get('code', '')).strip()
        if not code or not re.fullmatch(r'[A-Za-z0-9_-]+', code):
            return jsonify({'status': 'error', 'msg': '作业集代码不合法（仅字母数字_-）'}), 400
        ensure_jobs_dir()
        with open(os.path.join(JOBS_DIR, code + '.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({'status': 'success', 'msg': '已保存作业集 ' + code})
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500


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
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
