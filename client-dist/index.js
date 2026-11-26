import { defineComponent as ne, h as de, defineAsyncComponent as oe, computed as Y, ref as _, onUnmounted as fe, onMounted as ye, resolveComponent as ae, openBlock as n, createBlock as K, withCtx as le, createElementVNode as e, createElementBlock as s, Fragment as B, renderList as X, createVNode as m, normalizeClass as Z, createTextVNode as x, toDisplayString as g, createCommentVNode as p, resolveDynamicComponent as Ce, useId as pe, withKeys as ve, withModifiers as ce, unref as ie, normalizeStyle as xe, nextTick as Me, withDirectives as Ae, vModelText as Ie, reactive as Oe } from "vue";
import { send as ee, icons as Ne, SchemaBase as Pe, Schema as Le } from "@koishijs/client";
import { useRoute as Te, onBeforeRouteLeave as $e, onBeforeRouteUpdate as Se } from "vue-router";
const Q = {
  /** 拉取 hdsi-overview DataService 快照。 */
  async overview() {
    return ee("hdsi-overview/get");
  },
  /** 读取一节配置（authority=1）。无活跃故事时 story 节返回空 values。 */
  async readConfig(t) {
    return ee("hdsi/config/read", t);
  },
  /** 提交一节配置（authority=3）。白名单外的键由服务端静默忽略。 */
  async saveConfig(t, u) {
    return ee("hdsi/config/save", { section: t, values: u });
  },
  /** 配置中心：读取菜单树（无参）或某开放节（authority=1）。 */
  async readConfigCenter(t) {
    return t ? ee("hdsi/config-center/read", t) : ee("hdsi/config-center/read");
  },
  /** 配置中心：按节提交 patch（authority=3）——服务端合并、预校验后
   * scope.update 持久化写回 koishi.yml 并热更新。 */
  async saveConfigCenter(t, u, a = {}) {
    return ee("hdsi/config-center/save", { section: t, patch: u, ...a });
  },
  /** 通信动作只读视图：账本/计划派生的动作列表（authority=1，游标分页）。 */
  async actionsList(t, u = 20) {
    return ee("hdsi/actions/list", { cursor: t, limit: u });
  },
  /** 通信动作详情（按动作 ID 惰性读取，含分段与原文摘录）。 */
  async actionDetail(t) {
    return ee("hdsi/actions/get", { id: t });
  },
  /** 取消未来计划/未执行分段（authority=3；服务端幂等）。 */
  async cancelAction(t) {
    return ee("hdsi/actions/cancel", { id: t });
  },
  /** unknown 分段人工核实（authority=3）。 */
  async verifyAction(t, u) {
    return ee("hdsi/actions/verify", { id: t, outcome: u });
  }
}, we = {
  overview: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  desk: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm9.1 15.6L15.5 15.5M7.5 10.5h6M10.5 7.5v6",
  density: "M4 20v-6M9.3 20V9M14.6 20V4M20 20v-9",
  config: "M4 7.5h7M15 7.5h5M15 4.5v6M4 16.5h3M11 16.5h9M9 13.5v6",
  actions: "M4 5h16v11H9l-5 4V5zm4 4h8M8 12h5",
  center: "M4 7h4.5M11.5 7H20M4 17h9.5M16.5 17H20M7.2 4.4v5.2M13.2 14.4v5.2"
}, qe = ne({
  name: "IconSet",
  props: { name: { type: String, required: !0 } },
  render() {
    return de("path", { d: we[this.name] ?? we.overview });
  }
}), Ee = { class: "hdsi-host-title" }, je = { class: "hdsi-shell" }, De = { class: "topbar" }, Ve = { class: "tabs" }, Be = {
  class: "glyph",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.7",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true"
}, Je = { class: "main" }, Re = {
  key: 0,
  class: "notice info"
}, Fe = {
  key: 1,
  class: "notice warn"
}, ze = {
  key: 0,
  class: "snapshot-actions"
}, He = {
  key: 0,
  class: "notice warn"
}, Ue = ["disabled"], Ke = /* @__PURE__ */ ne({
  name: "HdsiApp",
  __name: "HdsiApp",
  setup(t) {
    const u = [
      { id: "overview", path: "/hdsi/overview", label: "概览", group: "运行", icon: "overview", component: oe(() => Promise.resolve().then(() => $t)) },
      { id: "config-center", path: "/hdsi/config-center", label: "配置中心", group: "配置", icon: "center", component: oe(() => Promise.resolve().then(() => Wt)) },
      { id: "config", path: "/hdsi/config", label: "当前故事", group: "配置", icon: "config", component: oe(() => Promise.resolve().then(() => gl)) },
      { id: "desk", path: "/hdsi/desk", label: "考据案头", group: "观测", icon: "desk", component: oe(() => Promise.resolve().then(() => _l)) },
      { id: "actions", path: "/hdsi/actions", label: "通信动作", group: "观测", icon: "actions", component: oe(() => Promise.resolve().then(() => Ql)) },
      { id: "density", path: "/hdsi/density", label: "上下文预算", group: "观测", icon: "density", component: oe(() => Promise.resolve().then(() => sn)) }
    ], a = Te(), O = Y(() => {
      const S = a.params.page, d = Array.isArray(S) ? S[0] : S;
      return u.some((l) => l.id === d) ? d : "overview";
    }), w = Y(() => !["config", "config-center", "actions"].includes(O.value)), r = _(null), v = _(!0), o = _("");
    let i = 0, $ = !1;
    fe(() => {
      $ = !0, i++;
    });
    async function f() {
      if ($) return;
      const S = ++i, d = () => !$ && S === i;
      v.value = !0, o.value = "";
      try {
        const l = await Q.overview();
        if (!d()) return;
        if (!l) throw new Error("Console 连接尚未就绪，请重试。");
        r.value = l;
      } catch (l) {
        d() && (o.value = (l == null ? void 0 : l.message) ?? String(l));
      } finally {
        d() && (v.value = !1);
      }
    }
    return ye(f), (S, d) => {
      const l = ae("router-link"), L = ae("k-layout");
      return n(), K(L, { main: "hdsi-layout" }, {
        header: le(() => {
          var k;
          return [
            e("span", Ee, [
              d[0] || (d[0] = x("HDSI ", -1)),
              e("small", null, g(((k = r.value) == null ? void 0 : k.version) ?? "写作工作台"), 1)
            ])
          ];
        }),
        default: le(() => [
          e("div", je, [
            e("header", De, [
              e("nav", Ve, [
                (n(), s(B, null, X(u, (k) => m(l, {
                  key: k.id,
                  to: k.path,
                  class: Z(["tab", { on: O.value === k.id }])
                }, {
                  default: le(() => [
                    (n(), s("svg", Be, [
                      m(qe, {
                        name: k.icon
                      }, null, 8, ["name"])
                    ])),
                    x(" " + g(k.label), 1)
                  ]),
                  _: 2
                }, 1032, ["to", "class"])), 64))
              ])
            ]),
            e("main", Je, [
              w.value && !r.value ? (n(), s(B, { key: 0 }, [
                v.value ? (n(), s("div", Re, "正在连接 HDSI 数据服务……")) : (n(), s("div", Fe, [
                  x(" 数据服务不可用：" + g(o.value) + " ", 1),
                  e("button", {
                    class: "refresh",
                    onClick: f
                  }, "重试")
                ]))
              ], 64)) : (n(), s(B, { key: 1 }, [
                w.value ? (n(), s("div", ze, [
                  o.value ? (n(), s("span", He, "刷新失败：" + g(o.value) + "，当前展示上次快照。", 1)) : p("", !0),
                  e("button", {
                    class: "refresh",
                    disabled: v.value,
                    onClick: f
                  }, g(v.value ? "刷新中……" : "刷新概览"), 9, Ue)
                ])) : p("", !0),
                (n(), K(Ce(u.find((k) => k.id === O.value).component), { overview: r.value }, null, 8, ["overview"]))
              ], 64))
            ])
          ])
        ]),
        _: 1
      });
    };
  }
}), te = (t, u) => {
  const a = t.__vccOpts || t;
  for (const [O, w] of u)
    a[O] = w;
  return a;
}, We = /* @__PURE__ */ te(Ke, [["__scopeId", "data-v-83d18947"]]);
function vn(t) {
  Ne.register("hdsi", {
    render: () => de("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.8,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      width: 24,
      height: 24,
      style: "width:24px;height:24px;max-width:100%;display:block;margin:auto;flex:none"
    }, [
      de("rect", { x: "4", y: "4", width: "10", height: "10", transform: "rotate(45 9 9)" }),
      de("path", { d: "M20 11v9h-9" }),
      de("circle", { cx: "20", cy: "8", r: "2" })
    ])
  }), t.page({
    id: "hdsi",
    path: "/hdsi/:page*",
    name: "HDS Interlude",
    icon: "hdsi",
    order: 600,
    component: We
  });
}
const Ye = ["aria-expanded", "aria-describedby", "onKeydown"], Ge = ["id"], Qe = { key: 0 }, Xe = {
  key: 1,
  class: "tip-range"
}, Ze = /* @__PURE__ */ ne({
  name: "InfoDot",
  __name: "InfoDot",
  props: {
    info: {},
    range: {}
  },
  setup(t) {
    const u = _(!1), a = _(null), O = pe();
    let w = 0;
    ye(() => {
      typeof window < "u" && window.addEventListener("scroll", o, !0);
    }), fe(() => {
      typeof window < "u" && window.removeEventListener("scroll", o, !0);
    });
    const r = _({ left: "0px", top: "0px", maxWidth: "320px" });
    async function v(i) {
      const f = i.currentTarget.getBoundingClientRect(), S = Math.min(320, window.innerWidth - 32), d = window.innerHeight - f.bottom > 140;
      r.value = {
        left: `${Math.max(16, Math.min(f.left, window.innerWidth - S - 16))}px`,
        top: `${d ? f.bottom + 8 : Math.max(16, f.top - 140)}px`,
        maxWidth: `${S}px`
      }, u.value = !0;
      const l = ++w;
      if (await Me(), !u.value || l !== w || !a.value) return;
      const L = a.value.getBoundingClientRect().height;
      r.value.top = `${Math.max(8, Math.min(Number.parseFloat(r.value.top), window.innerHeight - L - 8))}px`;
    }
    function o() {
      u.value = !1, w++;
    }
    return (i, $) => (n(), s("button", {
      type: "button",
      class: "info-dot",
      "aria-label": "查看说明（悬停或按住）",
      "aria-expanded": u.value,
      "aria-describedby": u.value ? ie(O) : void 0,
      onMouseenter: v,
      onMouseleave: o,
      onPointerdown: ce(v, ["stop"]),
      onPointerup: o,
      onPointercancel: o,
      onFocus: v,
      onBlur: o,
      onClick: ce(o, ["stop"]),
      onKeydown: [
        ve(o, ["esc"]),
        ve(ce(v, ["prevent"]), ["space"]),
        ve(ce(v, ["prevent"]), ["enter"])
      ],
      onKeyup: [
        ve(o, ["space"]),
        ve(o, ["enter"])
      ]
    }, [
      $[0] || ($[0] = e("svg", {
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.8",
        "aria-hidden": "true"
      }, [
        e("circle", {
          cx: "12",
          cy: "12",
          r: "9"
        }),
        e("path", { d: "M12 11v5" }),
        e("circle", {
          cx: "12",
          cy: "7.5",
          r: ".8",
          fill: "currentColor",
          stroke: "none"
        })
      ], -1)),
      u.value ? (n(), s("span", {
        key: 0,
        id: ie(O),
        ref_key: "tooltip",
        ref: a,
        class: "hdsi-tip",
        role: "tooltip",
        style: xe(r.value)
      }, [
        t.info ? (n(), s("span", Qe, g(t.info), 1)) : p("", !0),
        t.range ? (n(), s("span", Xe, "范围：" + g(t.range), 1)) : p("", !0)
      ], 12, Ge)) : p("", !0)
    ], 40, Ye));
  }
}), _e = /* @__PURE__ */ te(Ze, [["__scopeId", "data-v-d68b18ae"]]), et = {
  name: "DataRow",
  components: { InfoDot: _e },
  props: {
    label: { type: String, required: !0 },
    value: { type: [String, Number, Boolean], default: "—" },
    state: { type: String, default: "" },
    // 'ok' | 'warn' | 'acc'
    info: { type: String, default: "" },
    range: { type: String, default: "" }
  }
}, tt = { class: "row" }, lt = { class: "k" };
function nt(t, u, a, O, w, r) {
  const v = ae("InfoDot");
  return n(), s("div", tt, [
    e("span", lt, [
      x(g(a.label) + " ", 1),
      a.info || a.range ? (n(), K(v, {
        key: 0,
        info: a.info,
        range: a.range
      }, null, 8, ["info", "range"])) : p("", !0)
    ]),
    e("span", {
      class: Z(["v", a.state || void 0])
    }, g(a.value), 3)
  ]);
}
const h = /* @__PURE__ */ te(et, [["render", nt], ["__scopeId", "data-v-4e9413bc"]]), at = { key: 0 }, st = {
  key: 0,
  class: "notice info"
}, ot = {
  key: 1,
  class: "notice"
}, it = {
  class: "metrics",
  "aria-label": "关键指标"
}, ut = { class: "overview-columns" }, rt = { class: "overview-stack" }, vt = { class: "card" }, dt = { class: "card-links" }, ct = {
  key: 0,
  class: "card"
}, ft = { class: "card" }, yt = { class: "card" }, ht = { class: "overview-stack" }, gt = { class: "card" }, mt = { class: "card" }, bt = { class: "card-links" }, wt = { class: "card" }, kt = /* @__PURE__ */ ne({
  name: "OverviewPage",
  __name: "OverviewPage",
  props: {
    overview: {}
  },
  setup(t) {
    const u = t, a = { active: "活动中", paused: "已暂停", archived: "已归档" }, O = { "device-focus-chat": "查看聊天", "device-focus-other": "使用设备", "busy-work": "专注事务", "busy-play": "投入娱乐", "avaliable-relax": "放松空闲", "avaliable-tense": "警觉空闲", "rest-conscious": "清醒休息", "rest-dazed": "朦胧休息", asleep: "睡眠", resting: "休息", occupied: "忙碌", available: "空闲", normal: "日常", active: "活跃", "phone-focused": "关注消息", focused: "专注" }, w = Y(() => {
      var d, l, L, k;
      return O[(l = (d = u.overview) == null ? void 0 : d.story) == null ? void 0 : l.rhythm] ?? ((k = (L = u.overview) == null ? void 0 : L.story) == null ? void 0 : k.rhythm) ?? "未建立";
    }), r = Y(() => {
      var d, l;
      return (l = (d = u.overview) == null ? void 0 : d.story) == null ? void 0 : l.eventAttention;
    }), v = {
      current: "有效",
      missing: "未建立 · 中性档",
      stale: "已过期 · 中性档",
      legacy: "旧档未细分 · 中性档"
    }, o = Y(() => {
      var d, l, L;
      return ((d = r.value) == null ? void 0 : d.status) === "missing" ? "未建立" : `${w.value}（${(L = (l = u.overview) == null ? void 0 : l.story) == null ? void 0 : L.rhythm}）`;
    }), i = { low: "低密度", normal: "日常", high: "高密度", burst: "密集对话" }, $ = (d) => d === "auto" ? "自动" : d === "fixed" ? "固定" : "—", f = { main: "主叙事", compaction: "记忆整理", timeline: "时间导演", alter: "情绪分析", embedding: "向量检索", stickers: "表情包描述", vision: "视觉理解", research: "考据检索" }, S = {
      allowProactiveMessages: "主角可主动发起可见消息（非回复式）",
      urge: "依据生活节奏和对话密度安排后台补写；人物是否联系他人由主叙事形成动作",
      sceneConditions: "设备、隐私和负荷的有效场景证据，与 Focus 相互独立；设备可达性不参与当前 T 档标注",
      deliveryPolicy: "管理员设置的主动出站运行额度和间隔；人物动机由主叙事决定",
      research: "考据 Agent：人物形成查证动作后，后台核实并写入考据案头，供后续写作参考",
      jev: "生活推进前的外部考据判定；命中时先检索资料，再继续写作"
    };
    return (d, l) => {
      var k, j, z, J, T, P, R, I, D, A, H, C, M, c, V, se, he, ue, b, y, N, q, F, E, G, U, re, ge, me, be;
      const L = ae("router-link");
      return t.overview ? (n(), s("div", at, [
        l[21] || (l[21] = e("div", { class: "pg-head" }, [
          e("div", null, [
            e("h2", null, "概览"),
            e("div", { class: "sub" }, "故事现场、推进时钟、上下文预算与模型配置的当前快照")
          ])
        ], -1)),
        (k = t.overview.story) != null && k.found ? (n(), s("div", st, [
          e("b", null, g(t.overview.story.characterName), 1),
          x(" · " + g(a[t.overview.story.status] ?? t.overview.story.status) + " · " + g(r.value && r.value.status !== "current" ? "已存 Focus" : "当前 Focus") + " " + g(w.value) + "。剧情时间 ", 1),
          e("code", null, g(t.overview.story.cursorLocal), 1),
          l[0] || (l[0] = x("，共 ", -1)),
          e("b", null, g(t.overview.story.entryCount), 1),
          l[1] || (l[1] = x(" 条剧本记录。 ", -1))
        ])) : (n(), s("div", ot, "当前还没有故事。先在配置中心填写故事档案和模型，再从聊天启动故事。")),
        e("div", it, [
          e("div", null, [
            l[2] || (l[2] = e("span", null, "剧本记录", -1)),
            e("strong", null, g(((j = t.overview.story) == null ? void 0 : j.entryCount) ?? 0), 1)
          ]),
          e("div", null, [
            l[3] || (l[3] = e("span", null, "关系人数", -1)),
            e("strong", null, g(((z = t.overview.story) == null ? void 0 : z.participantCount) ?? 0), 1)
          ]),
          e("div", null, [
            l[5] || (l[5] = e("span", null, "私聊上下文", -1)),
            e("strong", null, [
              x(g(((P = (T = (J = t.overview.density) == null ? void 0 : J.budgets) == null ? void 0 : T.private) == null ? void 0 : P.count) ?? ((R = t.overview.density) == null ? void 0 : R.effectiveLimit) ?? "—") + " ", 1),
              l[4] || (l[4] = e("small", null, "条", -1))
            ])
          ]),
          e("div", null, [
            l[7] || (l[7] = e("span", null, "群聊上下文", -1)),
            e("strong", null, [
              x(g(((A = (D = (I = t.overview.density) == null ? void 0 : I.budgets) == null ? void 0 : D.group) == null ? void 0 : A.count) ?? "—") + " ", 1),
              l[6] || (l[6] = e("small", null, "条", -1))
            ])
          ])
        ]),
        e("div", ut, [
          e("div", rt, [
            e("div", vt, [
              l[10] || (l[10] = e("h3", null, [
                e("span", { class: "sq" }),
                x("故事状态")
              ], -1)),
              m(h, {
                label: "主角",
                value: t.overview.story.characterName || "—",
                info: "主角姓名，出现在全部叙事中",
                range: "任意非空中文/英文"
              }, null, 8, ["value"]),
              m(h, {
                label: "关系人数",
                value: t.overview.story.participantCount,
                info: "已登记的参与者（跨会话共享同一故事）"
              }, null, 8, ["value"]),
              m(h, {
                label: "故事状态",
                value: a[t.overview.story.status] ?? t.overview.story.status,
                state: t.overview.story.status === "active" ? "ok" : "",
                info: "active=活动 / paused=暂停 / archived=归档"
              }, null, 8, ["value", "state"]),
              r.value ? p("", !0) : (n(), K(h, {
                key: 0,
                label: "生活节奏",
                value: w.value,
                state: "acc",
                info: "最近保存的生活节奏状态"
              }, null, 8, ["value"])),
              m(h, {
                label: "场景地点",
                value: t.overview.story.location || "待建立",
                info: "优先显示当前场景中的地点，缺失时显示故事档案的主要地点"
              }, null, 8, ["value"]),
              m(h, {
                label: "正在进行",
                value: t.overview.story.activity || "待建立",
                info: "来自已落库的场景状态"
              }, null, 8, ["value"]),
              m(h, {
                label: "叙事焦点",
                value: t.overview.story.focus || "待建立"
              }, null, 8, ["value"]),
              m(h, {
                label: "故事时区",
                value: t.overview.story.timezone || "—"
              }, null, 8, ["value"]),
              e("div", dt, [
                m(L, { to: "/hdsi/config" }, {
                  default: le(() => [...l[8] || (l[8] = [
                    x("编辑当前故事", -1)
                  ])]),
                  _: 1
                }),
                m(L, { to: "/hdsi/actions" }, {
                  default: le(() => [...l[9] || (l[9] = [
                    x("查看通信动作", -1)
                  ])]),
                  _: 1
                })
              ])
            ]),
            r.value ? (n(), s("div", ct, [
              l[11] || (l[11] = e("h3", null, [
                e("span", { class: "sq" }),
                x("Focus 与事件注意度")
              ], -1)),
              m(h, {
                label: "已存 Focus",
                value: o.value,
                state: "acc",
                info: "主叙事在剧本提交后更新；压缩器可补写。收到私聊不会改变或续期 Focus。"
              }, null, 8, ["value"]),
              m(h, {
                label: "标注依据",
                value: v[r.value.status] ?? "未知",
                state: r.value.status === "current" ? "ok" : "warn",
                info: "以概览读取时间判断，超过两小时使用中性行；旧档中仅有效的 asleep 可直接使用。"
              }, null, 8, ["value", "state"]),
              r.value.assessedAtLocal ? (n(), K(h, {
                key: 0,
                label: "证据时间",
                value: r.value.assessedAtLocal,
                info: "按故事时区显示的剧本证据时间"
              }, null, 8, ["value"])) : p("", !0),
              l[12] || (l[12] = e("p", { class: "attention-caption" }, "按当前状态预览，非上次请求记录。T1 最容易被注意到，T5 最不容易；只给已有材料加标注，不改变顺序，也不表示已读或必须回复。", -1)),
              m(h, {
                label: "私聊入站",
                value: `T${r.value.tiers.privateBatch}`
              }, null, 8, ["value"]),
              m(h, {
                label: "群聊入站 / 群聊背景",
                value: `T${r.value.tiers.groupBatch} / T${r.value.tiers.groupBackground}`
              }, null, 8, ["value"]),
              m(h, {
                label: "社交动态",
                value: `T${r.value.tiers.friendFeed}`
              }, null, 8, ["value"]),
              m(h, {
                label: "实况天气基础档",
                value: `T${r.value.tiers.weather}`,
                info: "恶劣天气前移两档，明显变化用基础档，其余后移一档；限定 T1–T5。不因分档增加新事件。"
              }, null, 8, ["value"]),
              m(h, {
                label: "播种世界事件",
                value: "按重要性 × 涉及程度",
                info: "environment 为环境事件、involved 为直接涉及主角或其关系和事务。每条独立计算，不受 Focus 影响。"
              }),
              l[13] || (l[13] = e("p", { class: "attention-caption" }, "设备可达性见「当前行动条件」，是独立状态；本功能不按它过滤消息。", -1))
            ])) : p("", !0),
            e("div", ft, [
              l[14] || (l[14] = e("h3", null, [
                e("span", { class: "sq" }),
                x("推进时钟")
              ], -1)),
              m(h, {
                label: "剧情时间",
                value: t.overview.story.cursorLocal || "—",
                info: "剧本已经推进到的故事时间"
              }, null, 8, ["value"]),
              m(h, {
                label: "补写最早时间",
                value: t.overview.story.nextAdvanceLocal || "尚未安排",
                info: "持久化的自动补写时钟；实际执行还取决于故事状态、任务队列和运行条件"
              }, null, 8, ["value"]),
              m(h, {
                label: "上次自动补写",
                value: t.overview.story.lastAdvanceLocal || "暂无记录"
              }, null, 8, ["value"]),
              m(h, {
                label: "对话后续时点",
                value: t.overview.story.followUpCount ?? 0,
                info: "已排定的对话后续时点数量"
              }, null, 8, ["value"])
            ]),
            e("div", yt, [
              l[15] || (l[15] = e("h3", null, [
                e("span", { class: "sq" }),
                x("系统开关")
              ], -1)),
              (n(!0), s(B, null, X(t.overview.switches, (W) => (n(), K(h, {
                key: W.key,
                label: W.label,
                value: W.value,
                state: W.ok === !0 ? "ok" : W.ok === !1 ? "warn" : "",
                info: S[W.key]
              }, null, 8, ["label", "value", "state", "info"]))), 128))
            ])
          ]),
          e("div", ht, [
            e("div", gt, [
              l[16] || (l[16] = e("h3", null, [
                e("span", { class: "sq" }),
                x("模型连接")
              ], -1)),
              (n(!0), s(B, null, X(t.overview.models, (W) => (n(), K(h, {
                key: W.task,
                label: f[W.task] ?? W.task,
                value: `${W.provider} · ${W.model}`,
                state: W.available ? "ok" : W.reason === "disabled" ? "" : "warn",
                info: "按模型中心的用途配置解析出的连接与模型；该状态表示配置匹配，不表示网络探活成功"
              }, null, 8, ["label", "value", "state"]))), 128))
            ]),
            e("div", mt, [
              l[19] || (l[19] = e("h3", null, [
                e("span", { class: "sq" }),
                x("上下文与对话密度")
              ], -1)),
              m(h, {
                label: "密度档位",
                value: i[(H = t.overview.density) == null ? void 0 : H.tier] ?? "—",
                info: "根据近期对话频率确定，供自动上下文预算使用"
              }, null, 8, ["value"]),
              m(h, {
                label: "5 / 15 / 30 分钟",
                value: `${((M = (C = t.overview.density) == null ? void 0 : C.counts) == null ? void 0 : M.count5) ?? 0} / ${((V = (c = t.overview.density) == null ? void 0 : c.counts) == null ? void 0 : V.count15) ?? 0} / ${((he = (se = t.overview.density) == null ? void 0 : se.counts) == null ? void 0 : he.count30) ?? 0}`,
                info: "各时间窗内的对话计数"
              }, null, 8, ["value"]),
              m(h, {
                label: "私聊模式",
                value: $(((y = (b = (ue = t.overview.density) == null ? void 0 : ue.budgets) == null ? void 0 : b.private) == null ? void 0 : y.mode) ?? ((N = t.overview.density) == null ? void 0 : N.mode))
              }, null, 8, ["value"]),
              m(h, {
                label: "群聊模式",
                value: $((E = (F = (q = t.overview.density) == null ? void 0 : q.budgets) == null ? void 0 : F.group) == null ? void 0 : E.mode)
              }, null, 8, ["value"]),
              m(h, {
                label: "时间窗口",
                value: ((re = (U = (G = t.overview.density) == null ? void 0 : G.budgets) == null ? void 0 : U.private) == null ? void 0 : re.minutes) === 0 ? "不限时间" : `${((be = (me = (ge = t.overview.density) == null ? void 0 : ge.budgets) == null ? void 0 : me.private) == null ? void 0 : be.minutes) ?? "—"} 分钟`,
                info: "与条目预算共同约束普通用户消息回合的近期上下文"
              }, null, 8, ["value"]),
              e("div", bt, [
                m(L, { to: "/hdsi/density" }, {
                  default: le(() => [...l[17] || (l[17] = [
                    x("查看密度详情", -1)
                  ])]),
                  _: 1
                }),
                m(L, { to: "/hdsi/config-center" }, {
                  default: le(() => [...l[18] || (l[18] = [
                    x("调整配置", -1)
                  ])]),
                  _: 1
                })
              ])
            ]),
            e("div", wt, [
              l[20] || (l[20] = e("h3", null, [
                e("span", { class: "sq" }),
                x("考据 Agent")
              ], -1)),
              m(h, {
                label: "状态",
                value: t.overview.research.enabled ? "开启" : "关闭",
                state: t.overview.research.enabled ? "ok" : "",
                info: "考据总开关，可在配置中心的「考据 Agent」中修改"
              }, null, 8, ["value", "state"]),
              m(h, {
                label: "搜索后端",
                value: t.overview.research.backend,
                state: "acc",
                info: "考据检索的网络后端",
                range: "auto/tavily/bocha/searxng/duckduckgo-html"
              }, null, 8, ["value"]),
              m(h, {
                label: "案头条目",
                value: t.overview.research.deskEntries,
                info: "在架的核实事实数（稳定+易变，TTL 过期淘汰）",
                range: "案头容量 2-32"
              }, null, 8, ["value"]),
              m(h, {
                label: "写入 / 复用",
                value: `${t.overview.research.counters.offered} / ${t.overview.research.counters.reused}`,
                info: "累计写入案头 / 复用已有条目（重载归零）"
              }, null, 8, ["value"]),
              m(h, {
                label: "Jev 门控",
                value: t.overview.research.jev.enabled ? t.overview.research.jev.keyConfigured ? `判定 ${t.overview.research.jev.calls} / 触发 ${t.overview.research.jev.triggered}` : "已开启 · 待配置密钥" : "未启用",
                state: t.overview.research.jev.enabled ? t.overview.research.jev.keyConfigured ? "ok" : "warn" : "",
                info: "判定=门控调用次数，触发=判定 TRUE 放行先查后写"
              }, null, 8, ["value", "state"])
            ])
          ])
        ])
      ])) : p("", !0);
    };
  }
}), pt = /* @__PURE__ */ te(kt, [["__scopeId", "data-v-05583d36"]]), $t = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: pt
}, Symbol.toStringTag, { value: "Module" })), St = { class: "cc" }, _t = ["disabled"], Ct = {
  key: 1,
  class: "hint"
}, xt = { class: "layout" }, Mt = {
  class: "menu",
  "aria-label": "配置分类"
}, At = { class: "search" }, It = {
  key: 0,
  class: "menu-summary"
}, Ot = ["disabled"], Nt = { class: "group" }, Pt = ["aria-current", "disabled", "onClick"], Lt = {
  key: 2,
  class: "hint"
}, Tt = { class: "content" }, qt = {
  key: 0,
  class: "hint"
}, Et = {
  key: 1,
  class: "card"
}, jt = { class: "hint" }, Dt = { class: "actions" }, Vt = {
  class: "save-state",
  role: "status"
}, Bt = ["disabled"], Jt = ["disabled"], Rt = ["disabled"], Ft = {
  key: 2,
  class: "hint"
}, zt = {
  key: 3,
  class: "landing"
}, Ht = ["onClick"], ke = "hdsi.config-center.section", Ut = /* @__PURE__ */ ne({
  name: "ConfigCenterPage",
  __name: "ConfigCenterPage",
  props: {
    overview: {}
  },
  setup(t) {
    const u = {
      blindMode: ["enabled"]
    }, a = _("");
    function O() {
      try {
        return window.sessionStorage.getItem(ke) ?? "";
      } catch {
        return "";
      }
    }
    function w(b) {
      try {
        window.sessionStorage.setItem(ke, b);
      } catch {
      }
    }
    const r = _([]), v = _(""), o = _(null), i = _(null), $ = _({}), f = _({}), S = _([]), d = _(!1), l = _(!1), L = _(!1), k = _(!1), j = _(""), z = _("ok"), J = _("");
    let T = 0, P = !1;
    fe(() => {
      P = !0, T++;
    });
    const R = Y(() => r.value.flatMap((b) => b.sections.filter((y) => y.stage === 1))), I = Y(() => J.value === v.value && JSON.stringify($.value) !== JSON.stringify(f.value)), D = Y(() => r.value.map((b) => ({ ...b, sections: b.sections.filter((y) => `${y.label} ${y.id} ${y.description}`.toLowerCase().includes(a.value.trim().toLowerCase())) })).filter((b) => b.sections.length)), A = () => !I.value || window.confirm("配置中心有未保存的修改。离开此页面？");
    $e(A), Se((b, y) => b.path === y.path || A());
    async function H(b) {
      b === v.value || k.value || I.value && !window.confirm("本节有尚未保存的修改。切换配置节将重新读取，继续切换？") || (b ? await se(b) : (T++, v.value = J.value = "", o.value = null, i.value = null, d.value = !1, j.value = "", w("")));
    }
    async function C() {
      d.value || k.value || !v.value || I.value && !window.confirm("重新读取将以已保存配置替换本节的未保存修改。继续？") || await se(v.value);
    }
    function M(b, y, N = "") {
      return Object.keys(b).flatMap((q) => {
        const F = N ? `${N}.${q}` : q;
        if (!(q in y)) return [F];
        const E = b[q], G = y[q];
        return E && G && typeof E == "object" && typeof G == "object" && !Array.isArray(E) && !Array.isArray(G) ? M(E, G, F) : [];
      });
    }
    function c(b) {
      for (const y of r.value) {
        const N = y.sections.find((q) => q.id === b);
        if (N) return N;
      }
    }
    async function V() {
      if (!(P || l.value)) {
        l.value = !0, L.value = !1, j.value = "";
        try {
          const b = await Q.readConfigCenter();
          if (P) return;
          if (!(b != null && b.ok) || !Array.isArray(b.menu)) throw new Error((b == null ? void 0 : b.error) ?? "菜单读取失败");
          r.value = b.menu;
          const y = O();
          R.value.some((N) => N.id === y) && await se(y);
        } catch (b) {
          P || (L.value = !0, j.value = `配置菜单读取失败：${(b == null ? void 0 : b.message) ?? String(b)}`, z.value = "warn");
        } finally {
          P || (l.value = !1);
        }
      }
    }
    async function se(b, y = !1) {
      const N = c(b);
      if (P || !N || N.stage !== 1) return;
      const q = ++T, F = () => !P && q === T && v.value === b;
      v.value = b, w(b), o.value = N, J.value = "", i.value = null, $.value = {}, f.value = {}, S.value = [], d.value = !0, y || (j.value = "");
      try {
        const E = await Q.readConfigCenter(b);
        if (!F()) return;
        if (!(E != null && E.ok)) throw new Error(E.error ?? "读取失败");
        if (!E.schema) throw new Error("配置结构读取失败");
        i.value = new Le(E.schema);
        const G = E.values ?? {};
        $.value = JSON.parse(JSON.stringify(G)), f.value = JSON.parse(JSON.stringify(G)), S.value = E.maskedFields ?? [], J.value = b;
      } catch (E) {
        F() && (j.value = `${y ? "配置已保存，重新读取失败：" : ""}${(E == null ? void 0 : E.message) ?? String(E)}`, z.value = "warn");
      } finally {
        F() && (d.value = !1);
      }
    }
    function he() {
      return (u[v.value] ?? []).filter((y) => JSON.stringify($.value[y]) !== JSON.stringify(f.value[y]));
    }
    async function ue(b = !1) {
      if (P || k.value || d.value || !v.value || J.value !== v.value) return;
      const y = v.value, N = T, q = () => !P && N === T && v.value === y, F = JSON.stringify($.value), E = JSON.parse(F), G = he();
      if (!(G.length && !window.confirm(`本次保存将修改影响排障能力的字段：${G.join("、")}。
盲区模式开启后将关闭管理指令并隐藏运行日志，恢复需在 Koishi 配置中关闭该开关并重载。

确认继续？`))) {
        k.value = !0, j.value = "";
        try {
          const U = await Q.saveConfigCenter(y, E, { reload: b, unset: M(f.value, E) });
          if (!q()) return;
          if (!(U != null && U.ok)) throw new Error(U.error ?? "未知错误");
          if (j.value = b ? "已保存，并已请求重载 HDSI。" : "已保存到 koishi.yml；配置更新已提交，插件将按需自动重载。", z.value = "ok", JSON.stringify($.value) === F) {
            const re = U.values ?? JSON.parse(F);
            $.value = re, f.value = JSON.parse(JSON.stringify(re)), S.value = U.maskedFields ?? S.value;
          } else
            f.value = JSON.parse(F);
        } catch (U) {
          q() && (j.value = `保存失败：${(U == null ? void 0 : U.message) ?? String(U)}`, z.value = "warn");
        } finally {
          P || (k.value = !1);
        }
      }
    }
    return ye(V), (b, y) => (n(), s("div", St, [
      y[10] || (y[10] = e("div", { class: "pg-head" }, [
        e("div", null, [
          e("h2", null, "配置中心"),
          e("div", { class: "sub" }, "按用途管理故事档案、模型、上下文与运行能力。修改仅在保存后写入配置文件。")
        ])
      ], -1)),
      j.value ? (n(), s("div", {
        key: 0,
        class: Z(["notice", z.value]),
        role: "status"
      }, [
        x(g(j.value) + " ", 1),
        L.value ? (n(), s("button", {
          key: 0,
          class: "save",
          disabled: l.value,
          onClick: V
        }, "重试", 8, _t)) : p("", !0)
      ], 2)) : p("", !0),
      l.value && !r.value.length ? (n(), s("div", Ct, "读取配置菜单……")) : p("", !0),
      e("div", xt, [
        e("aside", Mt, [
          e("label", At, [
            y[6] || (y[6] = e("span", null, "查找配置", -1)),
            Ae(e("input", {
              "onUpdate:modelValue": y[0] || (y[0] = (N) => a.value = N),
              type: "search",
              placeholder: "名称或字段，如 runtime",
              "aria-label": "查找配置节"
            }, null, 512), [
              [Ie, a.value]
            ])
          ]),
          r.value.length ? (n(), s("div", It, g(R.value.length) + " 个配置节 · 全部可编辑", 1)) : p("", !0),
          r.value.length ? (n(), s("button", {
            key: 1,
            type: "button",
            class: Z(["item", { on: !v.value }]),
            disabled: k.value,
            onClick: y[1] || (y[1] = (N) => H(""))
          }, "配置总览", 10, Ot)) : p("", !0),
          (n(!0), s(B, null, X(D.value, (N) => (n(), s(B, {
            key: N.id
          }, [
            e("div", Nt, g(N.label), 1),
            (n(!0), s(B, null, X(N.sections, (q) => (n(), s("button", {
              key: q.id,
              type: "button",
              class: Z(["item", { on: v.value === q.id }]),
              "aria-current": v.value === q.id ? "page" : void 0,
              disabled: k.value,
              onClick: (F) => H(q.id)
            }, g(q.label), 11, Pt))), 128))
          ], 64))), 128)),
          a.value && !D.value.length ? (n(), s("div", Lt, "没有匹配的配置节。")) : p("", !0)
        ]),
        e("main", Tt, [
          d.value ? (n(), s("div", qt, "读取中……")) : o.value && i.value ? (n(), s("div", Et, [
            e("h3", null, [
              y[7] || (y[7] = e("span", { class: "sq" }, null, -1)),
              x(g(o.value.label), 1)
            ]),
            e("div", jt, [
              x(g(o.value.description), 1),
              S.value.length ? (n(), s(B, { key: 0 }, [
                x(" 密钥已隐藏，保持占位值可保留原密钥；填写新值可替换。")
              ], 64)) : p("", !0)
            ]),
            (n(), K(ie(Pe).Form, {
              onSubmit: y[2] || (y[2] = ce(() => {
              }, ["prevent"])),
              key: J.value,
              inert: k.value || void 0,
              "aria-busy": k.value,
              schema: i.value,
              "model-value": $.value,
              initial: f.value,
              "onUpdate:modelValue": y[3] || (y[3] = (N) => $.value = N)
            }, null, 8, ["inert", "aria-busy", "schema", "model-value", "initial"])),
            e("div", Dt, [
              e("span", Vt, g(k.value ? "正在写入配置…" : I.value ? "有未保存的修改" : "与已读取配置一致"), 1),
              e("button", {
                class: "secondary",
                type: "button",
                disabled: k.value || d.value,
                onClick: C
              }, "重新读取", 8, Bt),
              e("button", {
                class: "save",
                type: "button",
                disabled: k.value || d.value || J.value !== v.value,
                onClick: y[4] || (y[4] = (N) => ue(!1))
              }, g(k.value ? "保存中……" : "保存本节"), 9, Jt),
              e("button", {
                class: "secondary",
                type: "button",
                disabled: k.value || d.value || J.value !== v.value,
                onClick: y[5] || (y[5] = (N) => ue(!0))
              }, "保存并重载", 8, Rt)
            ])
          ])) : !d.value && v.value ? (n(), s("div", Ft, [
            y[8] || (y[8] = x("本节读取失败。", -1)),
            e("button", {
              class: "secondary",
              onClick: C
            }, "重新读取")
          ])) : !d.value && r.value.length ? (n(), s("div", zt, [
            y[9] || (y[9] = e("div", { class: "card intro" }, [
              e("h3", null, "配置总览"),
              e("p", null, "从故事档案和模型接入开始，再按写作需要调整提示词、上下文和推进方式。"),
              e("p", null, "保存本节会写入配置并按需重载；保存并重载会主动重启插件。重载后保留本窗口正在编辑的配置节。")
            ], -1)),
            (n(!0), s(B, null, X(D.value, (N) => (n(), s("section", {
              key: N.id,
              class: "card"
            }, [
              e("h3", null, g(N.label), 1),
              (n(!0), s(B, null, X(N.sections, (q) => (n(), s("button", {
                key: q.id,
                class: "section-link",
                type: "button",
                onClick: (F) => H(q.id)
              }, [
                e("strong", null, g(q.label), 1),
                e("span", null, g(q.description), 1)
              ], 8, Ht))), 128))
            ]))), 128))
          ])) : p("", !0)
        ])
      ])
    ]));
  }
}), Kt = /* @__PURE__ */ te(Ut, [["__scopeId", "data-v-035f471e"]]), Wt = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Kt
}, Symbol.toStringTag, { value: "Module" })), Yt = {
  name: "EditField",
  components: { InfoDot: _e },
  props: {
    label: { type: String, required: !0 },
    modelValue: { type: [String, Number, Boolean], default: "" },
    type: { type: String, default: "text" },
    // text | number | boolean | select
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: "" },
    info: { type: String, default: "" },
    range: { type: String, default: "" },
    min: { type: Number },
    max: { type: Number },
    textarea: { type: Boolean, default: !1 },
    secret: { type: Boolean, default: !1 }
  },
  emits: ["update:modelValue"],
  setup() {
    return { inputId: pe() };
  },
  data() {
    return { visible: !1 };
  },
  computed: {
    currentValue: {
      get() {
        return this.modelValue;
      },
      set(t) {
        this.$emit("update:modelValue", t);
      }
    }
  },
  methods: {
    onBool() {
      this.$emit("update:modelValue", !this.modelValue);
    }
  }
}, Gt = { class: "field" }, Qt = ["for"], Xt = { class: "field-input" }, Zt = ["id", "value", "placeholder"], el = ["id", "value"], tl = ["value"], ll = ["id", "aria-checked", "aria-label"], nl = ["id", "value", "min", "max"], al = ["id", "type", "value", "placeholder"];
function sl(t, u, a, O, w, r) {
  const v = ae("InfoDot");
  return n(), s("div", Gt, [
    e("label", {
      class: "field-label",
      for: O.inputId
    }, [
      x(g(a.label) + " ", 1),
      a.info || a.range ? (n(), K(v, {
        key: 0,
        info: a.info,
        range: a.range
      }, null, 8, ["info", "range"])) : p("", !0)
    ], 8, Qt),
    e("div", Xt, [
      a.textarea ? (n(), s("textarea", {
        key: 0,
        id: O.inputId,
        value: String(a.modelValue ?? ""),
        placeholder: a.placeholder,
        class: "input area",
        onInput: u[0] || (u[0] = (o) => t.$emit("update:modelValue", o.target.value))
      }, null, 40, Zt)) : a.type === "select" ? (n(), s("select", {
        key: 1,
        id: O.inputId,
        value: String(a.modelValue),
        class: "input",
        onChange: u[1] || (u[1] = (o) => t.$emit("update:modelValue", o.target.value))
      }, [
        (n(!0), s(B, null, X(a.options, (o) => (n(), s("option", {
          key: o.value,
          value: o.value
        }, g(o.label), 9, tl))), 128))
      ], 40, el)) : a.type === "boolean" ? (n(), s("button", {
        key: 2,
        id: O.inputId,
        type: "button",
        role: "switch",
        "aria-checked": !!a.modelValue,
        "aria-label": a.label,
        class: Z(["toggle", { on: a.modelValue }]),
        onClick: u[2] || (u[2] = (...o) => r.onBool && r.onBool(...o))
      }, [...u[6] || (u[6] = [
        e("span", { class: "toggle-dot" }, null, -1)
      ])], 10, ll)) : a.type === "number" ? (n(), s("input", {
        key: 3,
        id: O.inputId,
        type: "number",
        value: Number(a.modelValue),
        min: a.min,
        max: a.max,
        class: "input",
        onInput: u[3] || (u[3] = (o) => t.$emit("update:modelValue", Number(o.target.value)))
      }, null, 40, nl)) : (n(), s("input", {
        key: 4,
        id: O.inputId,
        type: a.secret && !w.visible ? "password" : "text",
        value: String(a.modelValue ?? ""),
        placeholder: a.placeholder,
        class: "input",
        onInput: u[4] || (u[4] = (o) => t.$emit("update:modelValue", o.target.value))
      }, null, 40, al)),
      a.secret ? (n(), s("button", {
        key: 5,
        type: "button",
        class: "reveal",
        onClick: u[5] || (u[5] = (o) => w.visible = !w.visible)
      }, g(w.visible ? "隐藏" : "显示"), 1)) : p("", !0)
    ])
  ]);
}
const ol = /* @__PURE__ */ te(Yt, [["render", sl], ["__scopeId", "data-v-47b39beb"]]), il = {
  key: 1,
  class: "notice warn"
}, ul = { class: "card" }, rl = { class: "hint" }, vl = {
  key: 0,
  class: "hint"
}, dl = { class: "actions" }, cl = ["disabled"], fl = ["disabled"], yl = /* @__PURE__ */ ne({
  name: "ConfigPage",
  __name: "ConfigPage",
  props: {
    overview: {}
  },
  setup(t) {
    const u = [
      {
        id: "story",
        label: "故事设定",
        hint: "保存后更新当前故事，跨重启保留。",
        fields: [
          { key: "character.name", label: "主角姓名", type: "text", info: "主角姓名，出现在全部叙事中", range: "任意非空中文/英文" },
          { key: "character.profile", label: "人设描述", type: "text", textarea: !0, info: "主角的人设正文", range: "自由文本" },
          { key: "character.traits", label: "性格特质", type: "text", textarea: !0, info: "每行一条，落库为数组", range: "换行分隔文本" },
          { key: "world", label: "世界观", type: "text", textarea: !0, info: "世界观描述", range: "自由文本（≤4000 字）" },
          { key: "location", label: "主要地点", type: "text", info: "故事发生的核心场景" },
          { key: "supportingCast", label: "配角", type: "text", textarea: !0, info: "围绕主角的次要人物" },
          { key: "style", label: "叙事文风", type: "text", textarea: !0, info: "模型据此选择叙事措辞与节奏", range: "自由文本" },
          { key: "perspective", label: "主角视角层", type: "text", textarea: !0, info: "用于写作的主角感知、关注方式和表达习惯；作为独立视角层参与叙事" },
          { key: "defaultRelationship", label: "初始关系", type: "text", info: "新参与者与主角的默认关系" },
          { key: "timezone", label: "时区", type: "text", info: "IANA 时区", range: "如 Asia/Shanghai / America/New_York", placeholder: "Asia/Shanghai" }
        ]
      }
    ], a = _("story"), O = () => u.find((T) => T.id === a.value), w = Oe({}), r = _(!1), v = _(!1), o = _(""), i = _("ok"), $ = _(""), f = Y(() => !!l.value && JSON.stringify(w) !== $.value), S = () => !f.value || window.confirm("当前故事有未保存的修改。离开此页面？");
    $e(S), Se((T, P) => T.path === P.path || S());
    async function d() {
      f.value && !window.confirm("重新读取将使用服务器上的故事设定替换当前修改。继续？") || await j(a.value);
    }
    const l = _("");
    let L = 0, k = !1;
    fe(() => {
      k = !0, L++;
    });
    async function j(T) {
      var D;
      const P = u.find((A) => A.id === T);
      if (k || !P) return;
      const R = ++L, I = () => !k && R === L && a.value === T;
      a.value = T, l.value = "";
      for (const A of Object.keys(w)) delete w[A];
      r.value = !0, o.value = "";
      try {
        const A = await Q.readConfig(T);
        if (!A) throw new Error("Console 连接尚未就绪");
        if (!A.ok) throw new Error(A.error ?? "读取失败");
        if (!I()) return;
        for (const H of P.fields) {
          const C = (D = A.values) == null ? void 0 : D[H.key];
          w[H.key] = H.type === "boolean" ? C === !0 : C ?? (H.type === "number" ? 0 : "");
        }
        $.value = JSON.stringify(w), l.value = T;
      } catch (A) {
        I() && (o.value = (A == null ? void 0 : A.message) ?? String(A), i.value = "warn");
      } finally {
        I() && (r.value = !1);
      }
    }
    async function z() {
      if (k || v.value || r.value || l.value !== a.value) return;
      const T = a.value, P = L, R = () => !k && P === L && a.value === T, I = {};
      for (const A of O().fields) I[A.key] = w[A.key];
      const D = JSON.parse(JSON.stringify(I));
      v.value = !0, o.value = "";
      try {
        const A = await Q.saveConfig(T, D);
        if (!R()) return;
        if (!A.ok) throw new Error(A.error ?? "未知错误");
        $.value = JSON.stringify(D), o.value = `已写入 ${A.applied ?? 0} 项。${T === "story" ? "已保存到当前故事，后续写作立即使用。" : "已写入 koishi.yml，插件热更新生效。"}`, i.value = "ok";
      } catch (A) {
        R() && (o.value = `保存失败：${(A == null ? void 0 : A.message) ?? String(A)}`, i.value = "warn");
      } finally {
        k || (v.value = !1);
      }
    }
    const J = () => a.value === "story" && l.value === "story" && !w["character.name"] && !r.value;
    return ye(() => j("story")), (T, P) => {
      const R = ae("router-link");
      return n(), s("div", null, [
        P[2] || (P[2] = e("div", { class: "pg-head" }, [
          e("div", null, [
            e("h2", null, "当前故事"),
            e("div", { class: "sub" }, "编辑当前故事的设定，保存到故事数据库。新故事的默认档案在配置中心设置。")
          ])
        ], -1)),
        m(R, {
          to: "/hdsi/config-center",
          class: "redirect-card"
        }, {
          default: le(() => [...P[0] || (P[0] = [
            x("模型、上下文预算、运行时与考据设置 → 配置中心", -1)
          ])]),
          _: 1
        }),
        o.value ? (n(), s("div", {
          key: 0,
          class: Z(["notice", i.value]),
          role: "status"
        }, g(o.value), 3)) : p("", !0),
        J() ? (n(), s("div", il, "当前没有活跃故事——先在聊天里用 interlude.story.start 启动，再回来编辑故事设定。")) : p("", !0),
        e("div", ul, [
          e("h3", null, [
            P[1] || (P[1] = e("span", { class: "sq" }, null, -1)),
            x(g(O().label), 1)
          ]),
          e("div", rl, g(O().hint), 1),
          r.value ? (n(), s("div", vl, "读取中……")) : l.value === a.value && !J() ? (n(), s(B, { key: 1 }, [
            (n(!0), s(B, null, X(O().fields, (I) => (n(), K(ol, {
              key: I.key,
              modelValue: w[I.key],
              "onUpdate:modelValue": (D) => w[I.key] = D,
              label: I.label,
              type: I.type,
              options: I.options,
              info: I.info,
              range: I.range,
              min: I.min,
              max: I.max,
              textarea: I.textarea,
              secret: I.secret,
              placeholder: I.placeholder
            }, null, 8, ["modelValue", "onUpdate:modelValue", "label", "type", "options", "info", "range", "min", "max", "textarea", "secret", "placeholder"]))), 128)),
            e("div", dl, [
              e("button", {
                class: "refresh",
                disabled: r.value || v.value,
                onClick: d
              }, "重新读取", 8, cl),
              e("button", {
                class: "save",
                disabled: v.value || r.value || l.value !== a.value,
                onClick: z
              }, g(v.value ? "写入中……" : "保存故事设定"), 9, fl)
            ])
          ], 64)) : (n(), s("button", {
            key: 2,
            type: "button",
            class: "save",
            onClick: d
          }, "重新读取"))
        ])
      ]);
    };
  }
}), hl = /* @__PURE__ */ te(yl, [["__scopeId", "data-v-8946789c"]]), gl = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: hl
}, Symbol.toStringTag, { value: "Module" })), ml = { key: 0 }, bl = { class: "grid" }, wl = { class: "card" }, kl = { class: "card" }, pl = {
  key: 0,
  class: "notice info",
  style: { "margin-top": "8px" }
}, $l = /* @__PURE__ */ ne({
  name: "DeskPage",
  __name: "DeskPage",
  props: {
    overview: {}
  },
  setup(t) {
    return (u, a) => t.overview ? (n(), s("div", ml, [
      a[2] || (a[2] = e("div", { class: "pg-head" }, [
        e("div", null, [
          e("h2", null, "考据案头"),
          e("div", { class: "sub" }, "经核实的写作参考；资料可供作者使用，主角知情范围由剧情证据决定。")
        ])
      ], -1)),
      e("div", bl, [
        e("div", wl, [
          a[0] || (a[0] = e("h3", null, [
            e("span", { class: "sq" }),
            x("案头概况")
          ], -1)),
          m(h, {
            label: "在架条目",
            value: t.overview.research.deskEntries,
            info: "在架的核实事实数（稳定+易变，TTL 过期淘汰）",
            range: "案头容量 2-32，默认 8"
          }, null, 8, ["value"]),
          m(h, {
            label: "搜索后端",
            value: t.overview.research.backend,
            state: "acc",
            info: "考据检索的网络后端",
            range: "auto/tavily/bocha/searxng/duckduckgo-html"
          }, null, 8, ["value"]),
          m(h, {
            label: "查询缓存",
            value: `${t.overview.research.cache.size} 条（命中 ${t.overview.research.cache.hits} / 未命中 ${t.overview.research.cache.misses}）`,
            info: "搜索查询结果缓存——命中可省一次网络检索"
          }, null, 8, ["value"]),
          m(h, {
            label: "累计写入 / 复用 / 淘汰",
            value: `${t.overview.research.counters.offered} / ${t.overview.research.counters.reused} / ${t.overview.research.counters.evicted}`,
            info: "写入案头 / 复用已有条目 / 容量与 TTL 淘汰（重载归零）"
          }, null, 8, ["value"])
        ]),
        e("div", kl, [
          a[1] || (a[1] = e("h3", null, [
            e("span", { class: "sq" }),
            x("Jev 决策门控")
          ], -1)),
          m(h, {
            label: "状态",
            value: t.overview.research.jev.enabled ? t.overview.research.jev.keyConfigured ? "已启用" : "已开启 · 待配置密钥" : "未启用",
            state: t.overview.research.jev.enabled ? t.overview.research.jev.keyConfigured ? "ok" : "warn" : "",
            info: "自动生活推进前的考据判定；同时受考据总开关控制"
          }, null, 8, ["value", "state"]),
          m(h, {
            label: "判定 / 触发",
            value: `${t.overview.research.jev.calls} / ${t.overview.research.jev.triggered}`,
            info: "判定=门控调用次数，触发=判定 TRUE 放行先查后写（重载归零）"
          }, null, 8, ["value"]),
          t.overview.research.jev.enabled ? p("", !0) : (n(), s("div", pl, "如需在生活推进前判定是否查证，可在配置中心的「考据 Agent」中配置 Jev 密钥并启用门控。"))
        ])
      ]),
      a[3] || (a[3] = e("div", {
        class: "notice info",
        style: { "margin-top": "12px" }
      }, "当前页展示案头数量、缓存与门控的汇总状态；资料的使用情况可结合写作记录和考据日志核对。", -1))
    ])) : p("", !0);
  }
}), Sl = /* @__PURE__ */ te($l, [["__scopeId", "data-v-9c6e59c1"]]), _l = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Sl
}, Symbol.toStringTag, { value: "Module" })), Cl = { class: "pg-head" }, xl = { class: "sub" }, Ml = ["disabled"], Al = {
  key: 0,
  class: "error",
  role: "alert"
}, Il = {
  key: 1,
  class: "notice",
  role: "status"
}, Ol = {
  key: 2,
  class: "empty"
}, Nl = {
  key: 3,
  class: "empty"
}, Pl = { class: "list" }, Ll = ["aria-expanded", "disabled", "onClick"], Tl = ["data-kind"], ql = { class: "target" }, El = { class: "head" }, jl = ["data-status"], Dl = { class: "time" }, Vl = {
  key: 0,
  class: "detail"
}, Bl = { key: 0 }, Jl = {
  key: 4,
  class: "quote"
}, Rl = {
  key: 5,
  class: "ops"
}, Fl = {
  key: 0,
  class: "verify-hint"
}, zl = ["disabled"], Hl = ["disabled"], Ul = ["disabled"], Kl = ["onClick"], Wl = ["disabled"], Yl = /* @__PURE__ */ ne({
  name: "ActionsPage",
  __name: "ActionsPage",
  setup(t) {
    const u = _([]), a = _(0), O = _(void 0), w = _(!1), r = _(""), v = _(""), o = _(""), i = _(null), $ = _(!1), f = _(!1);
    let S = !1, d = 0, l = 0;
    const L = { action: "当前动作", plan: "人物计划", "fixed-delay": "确定延迟" }, k = {
      pending: "待执行",
      delivered: "已送达",
      partial: "部分送达",
      failed: "失败",
      cancelled: "已取消",
      unknown: "待核实",
      "pending-plan": "计划待处理"
    }, j = Y(() => i.value ? i.value.kind !== "action" ? !0 : i.value.segments.some((C) => C.status === "pending" || C.status === "unknown") : !1), z = Y(() => {
      var C;
      return !!((C = i.value) != null && C.segments.some((M) => M.status === "unknown"));
    }), J = {
      "plan-cancelled": "计划已取消",
      "segments-cancelled": "分段已取消",
      "nothing-pending": "没有待取消的分段",
      "nothing-unknown": "没有待核实的分段",
      "verified-delivered": "已核实为送达",
      "verified-not-sent": "已核实为未发送",
      "already-cancelled": "已是取消状态",
      "already-completed": "已完成，无需取消",
      "not-found": "记录已移除或不存在",
      "no-story": "没有活跃故事"
    }, T = {
      "console-cancel": "管理员取消后续",
      "manual-verified-delivered": "管理员已核实送达",
      "manual-verified-not-sent": "管理员已核实未发送",
      "policy-daily-cap": "滚动 24 小时额度已满",
      "policy-run-interval": "尚在最短运行间隔内",
      "policy-deferral-expired": "延期已超过有效期",
      "delivery-target-unavailable": "投递目标当前不可用",
      "delivery-source-unavailable": "消息来源当前不可用",
      "endpoint-registry-unavailable": "通信端点登记当前不可用",
      "delivery-generation-obsolete": "任务已由较新的运行状态接替",
      "delivery-unconfirmed-retry-scheduled": "投递尚未确认，已安排重试",
      "group-not-allowed": "当前群聊未获发送许可"
    };
    function P(C) {
      return T[C] ? `${T[C]}（${C}）` : C;
    }
    async function R(C) {
      if (f.value) return;
      const M = o.value;
      f.value = !0, v.value = "", r.value = "";
      try {
        const c = await C();
        if (S) return;
        if (!c.ok) throw new Error(J[c.reason] ?? c.reason ?? "操作失败");
        v.value = J[c.reason] ?? (c.changed ? "操作已完成。" : "状态已经更新，本次无需变更。"), c.changed > 0 && (await D(!0), !S && o.value === M && await I(M));
      } catch (c) {
        S || (r.value = c instanceof Error ? c.message : String(c));
      } finally {
        S || (f.value = !1);
      }
    }
    async function I(C) {
      r.value = "";
      const M = ++l;
      $.value = !0, i.value = null;
      try {
        const c = await Q.actionDetail(C);
        if (S || M !== l || o.value !== C) return;
        if (!c) throw new Error("该动作已不在当前记录中，请刷新列表。");
        i.value = c;
      } catch (c) {
        !S && M === l && (r.value = c instanceof Error ? c.message : String(c));
      } finally {
        !S && M === l && ($.value = !1);
      }
    }
    async function D(C = !0) {
      const M = ++d;
      w.value = !0, r.value = "";
      try {
        const c = await Q.actionsList(C ? void 0 : O.value);
        if (!c) throw new Error("Console 连接尚未就绪");
        if (S || M !== d) return;
        u.value = C ? c.rows : [...u.value, ...c.rows], a.value = c.total, O.value = c.cursor, C && o.value && !u.value.some((V) => V.id === o.value) && (o.value = "", i.value = null, l++, $.value = !1);
      } catch (c) {
        !S && M === d && (r.value = String(c));
      } finally {
        !S && M === d && (w.value = !1);
      }
    }
    async function A(C) {
      if (!f.value) {
        if (r.value = "", v.value = "", o.value === C) {
          o.value = "", i.value = null, l++, $.value = !1;
          return;
        }
        o.value = C, await I(C);
      }
    }
    function H(C) {
      if (!C) return "—";
      const M = new Date(C);
      return Number.isNaN(M.getTime()) ? "—" : M.toLocaleString();
    }
    return ye(() => void D()), fe(() => {
      S = !0, d++, l++;
    }), (C, M) => (n(), s("div", null, [
      e("div", Cl, [
        e("div", null, [
          M[5] || (M[5] = e("h2", null, "通信动作", -1)),
          e("div", xl, "查看作者动作、投递结果与未来计划；管理员可取消后续分段或核实未知回执。当前窗口共 " + g(a.value) + " 条。", 1)
        ]),
        e("button", {
          class: "refresh",
          disabled: w.value,
          onClick: M[0] || (M[0] = (c) => D(!0))
        }, "刷新", 8, Ml)
      ]),
      r.value ? (n(), s("div", Al, g(r.value), 1)) : p("", !0),
      v.value ? (n(), s("div", Il, g(v.value), 1)) : p("", !0),
      w.value && !u.value.length ? (n(), s("div", Ol, "正在读取通信动作…")) : p("", !0),
      !w.value && !u.value.length && !r.value ? (n(), s("div", Nl, "暂无动作记录。")) : p("", !0),
      e("div", Pl, [
        (n(!0), s(B, null, X(u.value, (c) => (n(), s("div", {
          key: c.id,
          class: Z(["row", { open: o.value === c.id }])
        }, [
          e("button", {
            type: "button",
            class: "row-main",
            "aria-expanded": o.value === c.id,
            disabled: f.value,
            onClick: (V) => A(c.id)
          }, [
            e("span", {
              class: "kind",
              "data-kind": c.kind
            }, g(L[c.kind] ?? c.kind), 9, Tl),
            e("span", ql, g(c.target), 1),
            e("span", El, g(c.head), 1),
            e("span", {
              class: "status",
              "data-status": c.status
            }, [
              x(g(k[c.status] ?? c.status), 1),
              c.segmentCount ? (n(), s(B, { key: 0 }, [
                x("（" + g(c.deliveredCount) + "/" + g(c.segmentCount) + "）", 1)
              ], 64)) : p("", !0)
            ], 8, jl),
            e("span", Dl, g(H(c.updatedAt)), 1)
          ], 8, Ll),
          o.value === c.id ? (n(), s("div", Vl, [
            $.value ? (n(), s("div", Bl, "读取中…")) : i.value ? (n(), s(B, { key: 1 }, [
              m(h, {
                label: "动作",
                value: i.value.id
              }, null, 8, ["value"]),
              m(h, {
                label: "渠道",
                value: i.value.channel === "group" ? "群聊" : "私聊"
              }, null, 8, ["value"]),
              i.value.dueAt ? (n(), K(h, {
                key: 0,
                label: "到期",
                value: H(i.value.dueAt)
              }, null, 8, ["value"])) : p("", !0),
              i.value.expiresAt ? (n(), K(h, {
                key: 1,
                label: "失效",
                value: H(i.value.expiresAt)
              }, null, 8, ["value"])) : p("", !0),
              i.value.reason ? (n(), K(h, {
                key: 2,
                label: "原因",
                value: P(i.value.reason)
              }, null, 8, ["value"])) : p("", !0),
              i.value.segments.length ? (n(), K(h, {
                key: 3,
                label: "分段",
                value: i.value.segments.map((V) => `第 ${V.index + 1} 段：${k[V.status] ?? V.status}${V.reason ? `（${P(V.reason)}）` : ""}`).join("；") || "—"
              }, null, 8, ["value"])) : p("", !0),
              i.value.quote ? (n(), s("div", Jl, "原文：" + g(i.value.quote), 1)) : p("", !0),
              j.value || z.value ? (n(), s("div", Rl, [
                z.value ? (n(), s("p", Fl, "根据平台实际记录核实；确认送达后，该结果会作为后续写作依据。")) : p("", !0),
                j.value ? (n(), s("button", {
                  key: 1,
                  disabled: f.value,
                  onClick: M[1] || (M[1] = (V) => R(() => ie(Q).cancelAction(i.value.id)))
                }, g(f.value ? "处理中…" : "取消后续"), 9, zl)) : p("", !0),
                z.value ? (n(), s("button", {
                  key: 2,
                  disabled: f.value,
                  class: "ok",
                  onClick: M[2] || (M[2] = (V) => R(() => ie(Q).verifyAction(i.value.id, "delivered")))
                }, "核实已送达", 8, Hl)) : p("", !0),
                z.value ? (n(), s("button", {
                  key: 3,
                  disabled: f.value,
                  onClick: M[3] || (M[3] = (V) => R(() => ie(Q).verifyAction(i.value.id, "not-sent")))
                }, "核实未发送", 8, Ul)) : p("", !0)
              ])) : p("", !0)
            ], 64)) : (n(), s("button", {
              key: 2,
              class: "refresh",
              onClick: (V) => I(c.id)
            }, "重试读取详情", 8, Kl))
          ])) : p("", !0)
        ], 2))), 128))
      ]),
      O.value ? (n(), s("button", {
        key: 4,
        class: "more",
        disabled: w.value,
        onClick: M[4] || (M[4] = (c) => D(!1))
      }, g(w.value ? "读取中…" : "加载更多"), 9, Wl)) : p("", !0)
    ]));
  }
}), Gl = /* @__PURE__ */ te(Yl, [["__scopeId", "data-v-3a8f7733"]]), Ql = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Gl
}, Symbol.toStringTag, { value: "Module" })), Xl = { key: 0 }, Zl = { class: "scope-controls" }, en = { class: "grid" }, tn = { class: "card" }, ln = { class: "card" }, nn = /* @__PURE__ */ ne({
  name: "DensityPage",
  __name: "DensityPage",
  props: {
    overview: {}
  },
  setup(t) {
    const u = t, a = _("private"), O = { burst: "极高密度", high: "高密度", normal: "日常", low: "低密度", advance: "自动推进" }, w = Y(() => {
      var i, $, f, S, d, l, L, k;
      const o = (S = (f = ($ = (i = u.overview) == null ? void 0 : i.density) == null ? void 0 : $.scopes) == null ? void 0 : f[a.value]) == null ? void 0 : S.mode;
      return o && o !== "inherit" ? o : ((l = (d = u.overview) == null ? void 0 : d.density) == null ? void 0 : l.globalMode) ?? ((k = (L = u.overview) == null ? void 0 : L.density) == null ? void 0 : k.mode) ?? "fixed";
    }), r = Y(() => {
      var $, f, S;
      const o = (($ = u.overview) == null ? void 0 : $.density) ?? {}, i = ((S = (f = o.scopes) == null ? void 0 : f[a.value]) == null ? void 0 : S.tiers) ?? {};
      return [
        { label: "极高密度", tier: "burst", limit: i.burst, info: "近 5 分钟至少 4 条消息" },
        { label: "高密度", tier: "high", limit: i.high, info: "近 5 分钟至少 2 条，或近 15 分钟至少 4 条消息" },
        { label: "日常", tier: "normal", limit: o.anchor, info: "使用 contextEntryLimit 作为日常档锚点" },
        { label: "低密度", tier: "low", limit: i.low, info: "近 30 分钟没有新消息" },
        { label: "自动推进", tier: "advance", limit: i.advance, info: "自动生活推进回合使用的档位" }
      ];
    }), v = Y(() => {
      var i, $, f;
      const o = w.value === "fixed" ? ($ = (i = u.overview) == null ? void 0 : i.density) == null ? void 0 : $.anchor : (f = r.value.find((S) => {
        var d, l;
        return S.tier === ((l = (d = u.overview) == null ? void 0 : d.density) == null ? void 0 : l.tier);
      })) == null ? void 0 : f.limit;
      return w.value === "auto" && o != null ? Math.max(4, Math.min(200, Math.floor(o))) : o;
    });
    return (o, i) => {
      const $ = ae("router-link");
      return t.overview ? (n(), s("div", Xl, [
        i[5] || (i[5] = e("div", { class: "pg-head" }, [
          e("div", null, [
            e("h2", null, "上下文预算"),
            e("div", { class: "sub" }, "近期原始剧本的保留预算。密度统计按当前故事计算，私聊与群聊可分别设置模式和档位。")
          ])
        ], -1)),
        e("div", Zl, [
          e("button", {
            class: Z({ on: a.value === "private" }),
            onClick: i[0] || (i[0] = (f) => a.value = "private")
          }, "私聊预算", 2),
          e("button", {
            class: Z({ on: a.value === "group" }),
            onClick: i[1] || (i[1] = (f) => a.value = "group")
          }, "群聊预算", 2),
          m($, { to: "/hdsi/config-center" }, {
            default: le(() => [...i[2] || (i[2] = [
              x("在配置中心调整 →", -1)
            ])]),
            _: 1
          })
        ]),
        e("div", en, [
          e("div", tn, [
            i[3] || (i[3] = e("h3", null, [
              e("span", { class: "sq" }),
              x("当前档位")
            ], -1)),
            m(h, {
              label: "模式",
              value: w.value === "auto" ? "随密度自适应" : "固定预算",
              state: "acc",
              info: "fixed 使用锚点与时间窗；auto 按本页档位动态选择",
              range: "fixed | auto"
            }, null, 8, ["value"]),
            m(h, {
              label: "档位",
              value: `${w.value === "auto" ? O[t.overview.density.tier] ?? t.overview.density.tier : "固定"} → ${v.value ?? "—"} 条`,
              info: "当前密度对应的用户回合预算；fixed 可额外合并时间窗，auto 使用至少 4 条的档位硬上限。自动推进回合使用推进档。"
            }, null, 8, ["value"]),
            m(h, {
              label: "近 5 分钟",
              value: `${t.overview.density.counts.count5} 条消息`,
              info: "入站消息计数——密度信号源之一（burst 判定窗）"
            }, null, 8, ["value"]),
            m(h, {
              label: "近 15 分钟",
              value: `${t.overview.density.counts.count15} 条消息`,
              info: "入站消息计数——high 判定窗"
            }, null, 8, ["value"]),
            m(h, {
              label: "近 30 分钟",
              value: `${t.overview.density.counts.count30} 条消息`,
              info: "入站消息计数——low 判定窗（轨迹重载归零）"
            }, null, 8, ["value"])
          ]),
          e("div", ln, [
            i[4] || (i[4] = e("h3", null, [
              e("span", { class: "sq" }),
              x("档位表")
            ], -1)),
            (n(!0), s(B, null, X(r.value, (f) => (n(), K(h, {
              key: f.label,
              class: Z(["row", { on: w.value === "auto" && t.overview.density.tier === f.tier }]),
              label: f.label,
              value: f.limit == null ? "未提供配置" : `${f.limit} 条`,
              info: f.info
            }, null, 8, ["class", "label", "value", "info"]))), 128))
          ])
        ])
      ])) : p("", !0);
    };
  }
}), an = /* @__PURE__ */ te(nn, [["__scopeId", "data-v-f55a4e87"]]), sn = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: an
}, Symbol.toStringTag, { value: "Module" }));
export {
  vn as default
};
