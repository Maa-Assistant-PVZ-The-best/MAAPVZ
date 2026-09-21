# -*- coding: utf-8 -*-
"""
plant_match.py —— 模板匹配核心（纯 numpy，无 cv2）
====================================================

对选卡界面截图，在给定 ROI 内查找某个植物的卡槽模板（支持多皮肤模板命中其一）。

算法：
    - 用 FFT 做 归一化互相关 (NCC)，避免滑动窗口暴力遍历；
    - 支持透明 PNG 用 alpha 做掩膜（背景无关，米色/深色背景均可用）；
    - 无 alpha 的模板退化为普通灰度 NCC；
    - 内置轻量多尺度搜索（默认 0.9x~1.1x, 0.05 步），抗轻微渲染差异。

不依赖 cv2 与 scipy，仅 numpy + plant_lib。
"""

import numpy as np

from plant_lib import (
    load_template_png,
    bgr_to_gray,
)


def _ncc_fft(scene_gray, templ_gray, mask=None):
    """一次 FFT 归一化互相关，返回与 scene 等大的相关图 (NaN 表示该处方差为 0/无有效数据)。

    scene_gray:  H x W float32
    templ_gray:  th x tw float32（模板灰度原图）
    mask:        th x tw float32 或 None（模板像素是否参与，来自 alpha）

    相关图每个位置 (i,j) 的值表示: 模板左上角放在场景 (i,j) 处的归一化相似度。
    """
    th, tw = templ_gray.shape
    sh, sw = scene_gray.shape

    if mask is not None:
        m = mask.astype(np.float32)
        mass = float(m.sum())
        if mass < 4.0:
            return None
        # 掩膜内均值、去均值、模板方差
        tbar = float((m * templ_gray).sum()) / mass
        tmc = (m * (templ_gray - tbar)).astype(np.float32)
        var_t = float((tmc * templ_gray).sum())
        if var_t < 1.0:
            return None
        # 场景在掩膜区域内的局部统计：用 FFT 把 m 当模板卷出局部和
        s2 = scene_gray * scene_gray
        num = _fft_corr(scene_gray, tmc, sh, sw, th, tw)
        isum = _fft_corr(scene_gray, m, sh, sw, th, tw)
        i2sum = _fft_corr(s2, m, sh, sw, th, tw)
        region_count = mass
    else:
        tmc = (templ_gray - templ_gray.mean()).astype(np.float32)
        var_t = float((tmc * templ_gray).sum())
        if var_t < 1.0:
            return None
        ones = np.ones_like(tmc, dtype=np.float32)
        s2 = scene_gray * scene_gray
        num = _fft_corr(scene_gray, tmc, sh, sw, th, tw)
        isum = _fft_corr(scene_gray, ones, sh, sw, th, tw)
        i2sum = _fft_corr(s2, ones, sh, sw, th, tw)
        region_count = float(tmc.size)

    # 局部方差 = E[x^2] - E[x]^2  （在掩膜质量 / 像素数归一意义下）
    var_i = i2sum - isum * isum / region_count

    denom = np.sqrt(np.maximum(var_i, 0.0) * var_t)
    ncc = np.zeros_like(num, dtype=np.float32)
    valid = denom > 1e-3
    ncc[valid] = num[valid] / denom[valid]
    ncc[~valid] = np.nan
    return ncc


def _fft_corr(scene, kernel, sh, sw, th, tw):
    """计算 scene 与 kernel 的互相关（全卷积），返回与 scene 同形状的 full 结果（无 padding 裁切）。

    内部用 FFT 卷积，输出尺寸 = (sh, sw)。
    """
    # 翻转 kernel 变成卷积
    k = kernel[::-1, ::-1].copy()
    fsh, fsw = sh + th - 1, sw + tw - 1
    fs = np.fft.rfft2(scene, s=(fsh, fsw))
    fk = np.fft.rfft2(k, s=(fsh, fsw))
    conv = np.fft.irfft2(fs * fk, s=(fsh, fsw))
    # 有效互相关位置: 卷积结果中索引对应 (i=th-1..sh-1, j=tw-1..sw-1)
    return conv[th - 1: th - 1 + sh, tw - 1: tw - 1 + sw]


def _resize_gray(gray, fx, fy):
    """纯 numpy 最近邻/双线性缩小放大灰度图。"""
    from PIL import Image
    h, w = gray.shape
    nw = max(1, int(round(w * fx)))
    nh = max(1, int(round(h * fy)))
    im = Image.fromarray(np.clip(gray, 0, 255).astype(np.uint8))
    im = im.resize((nw, nh), Image.BILINEAR)
    return np.asarray(im, dtype=np.float32)


def match_plants(
    img_bgr,
    templates,
    roi=None,
    threshold=0.70,
    scales=None,
    topk=1,
):
    """在图中查找一组模板（同植物多皮肤）。

    参数:
        img_bgr   : HxWx3 uint8 (BGR) 截图
        templates : list[Path] 候选模板 PNG（命中其一即算命中）
        roi       : [x,y,w,h] 限定搜索区域；None 表示全图
        threshold : 接受阈值 (0~1, NCC)
        scales    : 多尺度搜索倍数，默认 (0.9, 0.95, 1.0, 1.05, 1.1)
        topk      : 返回前 k 个最优命中（默认 1）

    返回:
        list[ dict{name,x,y,w,h,score,template} ]，按分数降序；无命中返回 []。
        box 坐标为整图坐标（x,y,w,h）。
    """
    gray = bgr_to_gray(img_bgr)
    H, W = gray.shape
    if roi is None:
        rx, ry, rw, rh = 0, 0, W, H
    else:
        rx, ry, rw, rh = [int(v) for v in roi]
        rw = max(1, min(rw, W - rx))
        rh = max(1, min(rh, H - ry))

    # 多尺度搜索覆盖变种/皮肤（覆盖变种渲染尺寸差异，但同时避免过宽导致跨卡假匹配）
    if scales is None:
        scales = (0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15)

    best = []
    for path in templates:
        tgray, mask = load_template_png(path)
        th, tw = tgray.shape

        for k in scales:
            if abs(k - 1.0) > 1e-6:
                ts = _resize_gray(tgray, k, k)
            else:
                ts = tgray
            tms = _resize_gray(mask, k, k) if mask is not None else None
            if tms is not None and tms.max() <= 0:
                tms = None
            th2, tw2 = ts.shape

            # 搜索区域要比模板大才匹配
            if rw < tw2 or rh < th2:
                continue

            # 只在 roi 内匹配：切子图
            sub = gray[ry:ry + rh, rx:rx + rw]
            ncc = _ncc_fft(sub, ts, tms)
            if ncc is None:
                continue
            # 忽略边界 1px（角点不稳）
            if tw2 > 2 and th2 > 2:
                ncc[0, :] = ncc[-1, :] = np.nan
                ncc[:, 0] = ncc[:, -1] = np.nan
            flat = ncc.ravel()
            idx = int(np.nanargmax(flat))
            score = float(flat[idx])
            if score >= threshold:
                iy, ix = divmod(idx, ncc.shape[1])
                best.append({
                    "name": path.stem,
                    "template": str(path),
                    "x": rx + ix,
                    "y": ry + iy,
                    "w": tw2,
                    "h": th2,
                    "score": score,
                    "scale": k,
                })

    best.sort(key=lambda d: d["score"], reverse=True)
    return best[:topk]


def find_best(img_bgr, templates, roi=None, threshold=0.70, scales=None):
    """最简入口：返回最优命中 dict 或 None。"""
    hits = match_plants(img_bgr, templates, roi=roi, threshold=threshold,
                        scales=scales, topk=1)
    return hits[0] if hits else None