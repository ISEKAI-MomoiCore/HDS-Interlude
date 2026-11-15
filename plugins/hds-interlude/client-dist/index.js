import { defineComponent as ee, h as se, defineAsyncComponent as ae, computed as F, ref as g, onUnmounted as ue, onMounted as ve, resolveComponent as le, openBlock as n, createBlock as z, withCtx as re, createElementVNode as e, createElementBlock as s, Fragment as L, renderList as Z, createVNode as A, normalizeClass as Q, createTextVNode as O, toDisplayString as y, createCommentVNode as p, resolveDynamicComponent as me, useId as fe, withKeys as oe, withModifiers as ie, unref as ne, normalizeStyle as be, nextTick as pe, withDirectives as ke, vModelText as we, reactive as _e } from "vue";
import { send as G, icons as $e, SchemaBase as Se, Schema as xe } from "@koishijs/client";
import { useRoute as Ce, onBeforeRouteLeave as ye, onBeforeRouteUpdate as he } from "vue-router";
const W = {
  /** 拉取 hdsi-overview DataService 快照。 */
  async overview() {
    return G("hdsi-overview/get");
  },
  /** 读取一节配置（authority=1）。无活跃故事时 story 节返回空 values。 */
  async readConfig(t) {
    return G("hdsi/config/read", t);
  },
  /** 提交一节配置（authority=3）。白名单外的键由服务端静默忽略。 */
  async saveConfig(t, r) {
    return G("hdsi/config/save", { section: t, values: r });
  },
  /** 配置中心：读取菜单树（无参）或某开放节（authority=1）。 */
  async readConfigCenter(t) {
    return t ? G("hdsi/config-center/read", t) : G("hdsi/config-center/read");
  },
  /** 配置中心：按节提交 patch（authority=3）——服务端合并、预校验后
   * scope.update 持久化写回 koishi.yml 并热更新。 */
  async saveConfigCenter(t, r, l = {}) {
    return G("hdsi/config-center/save", { section: t, patch: r, ...l });
  },
  /** 通信动作只读视图：账本/计划派生的动作列表（authority=1，游标分页）。 */
  async actionsList(t, r = 20) {
    return G("hdsi/actions/list", { cursor: t, limit: r });
  },
  /** 通信动作详情（按动作 ID 惰性读取，含分段与原文摘录）。 */
  async actionDetail(t) {
    return G("hdsi/actions/get", { id: t });
  },
  /** 取消未来计划/未执行分段（authority=3；服务端幂等）。 */
  async cancelAction(t) {
    return G("hdsi/actions/cancel", { id: t });
  },
  /** unknown 分段人工核实（authority=3）。 */
  async verifyAction(t, r) {
    return G("hdsi/actions/verify", { id: t, outcome: r });
  }
}, ce = {
  overview: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  desk: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm9.1 15.6L15.5 15.5M7.5 10.5h6M10.5 7.5v6",
  density: "M4 20v-6M9.3 20V9M14.6 20V4M20 20v-9",
  config: "M4 7.5h7M15 7.5h5M15 4.5v6M4 16.5h3M11 16.5h9M9 13.5v6",
  actions: "M4 5h16v11H9l-5 4V5zm4 4h8M8 12h5",
  center: "M4 7h4.5M11.5 7H20M4 17h9.5M16.5 17H20M7.2 4.4v5.2M13.2 14.4v5.2"
}, Me = ee({
  name: "IconSet",
  props: { name: { type: String, required: !0 } },
  render() {
    return se("path", { d: ce[this.name] ?? ce.overview });
  }
}), Ie = { class: "hdsi-host-title" }, Ae = { class: "hdsi-shell" }, Oe = { class: "topbar" }, Pe = { class: "tabs" }, Ne = {
  class: "glyph",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.7",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true"
}, je = { class: "main" }, De = {
  key: 0,
  class: "notice info"
}, qe = {
  key: 1,
  class: "notice warn"
}, Ee = {
  key: 0,
  class: "snapshot-actions"
}, Ve = {
  key: 0,
  class: "notice warn"
}, Le = ["disabled"], Te = /* @__PURE__ */ ee({
  name: "HdsiApp",
  __name: "HdsiApp",
  setup(t) {
    const r = [
      { id: "overview", path: "/hdsi/overview", label: "概览", group: "运行", icon: "overview", component: ae(() => Promise.resolve().then(() => st)) },
      { id: "config-center", path: "/hdsi/config-center", label: "配置中心", group: "配置", icon: "center", component: ae(() => Promise.resolve().then(() => Ot)) },
      { id: "config", path: "/hdsi/config", label: "当前故事", group: "配置", icon: "config", component: ae(() => Promise.resolve().then(() => Xt)) },
      { id: "desk", path: "/hdsi/desk", label: "考据案头", group: "观测", icon: "desk", component: ae(() => Promise.resolve().then(() => sa)) },
      { id: "actions", path: "/hdsi/actions", label: "通信动作", group: "观测", icon: "actions", component: ae(() => Promise.resolve().then(() => ja)) },
      { id: "density", path: "/hdsi/density", label: "上下文预算", group: "观测", icon: "density", component: ae(() => Promise.resolve().then(() => Ba)) }
    ], l = Ce(), k = F(() => {
      const b = l.params.page, S = Array.isArray(b) ? b[0] : b;
      return r.some((d) => d.id === S) ? S : "overview";
    }), u = F(() => !["config", "config-center", "actions"].includes(k.value)), f = g(null), w = g(!0), o = g("");
    let a = 0, m = !1;
    ue(() => {
      m = !0, a++;
    });
    async function i() {
      if (m) return;
      const b = ++a, S = () => !m && b === a;
      w.value = !0, o.value = "";
      try {
        const d = await W.overview();
        if (!S()) return;
        if (!d) throw new Error("Console 连接尚未就绪，请重试。");
        f.value = d;
      } catch (d) {
        S() && (o.value = (d == null ? void 0 : d.message) ?? String(d));
      } finally {
        S() && (w.value = !1);
      }
    }
    return ve(i), (b, S) => {
      const d = le("router-link"), P = le("k-layout");
      return n(), z(P, { main: "hdsi-layout" }, {
        header: re(() => {
          var C;
          return [
            e("span", Ie, [
              S[0] || (S[0] = O("HDSI ", -1)),
              e("small", null, y(((C = f.value) == null ? void 0 : C.version) ?? "写作工作台"), 1)
            ])
          ];
        }),
        default: re(() => [
          e("div", Ae, [
            e("header", Oe, [
              e("nav", Pe, [
                (n(), s(L, null, Z(r, (C) => A(d, {
                  key: C.id,
                  to: C.path,
                  class: Q(["tab", { on: k.value === C.id }])
                }, {
                  default: re(() => [
                    (n(), s("svg", Ne, [
                      A(Me, {
                        name: C.icon
                      }, null, 8, ["name"])
                    ])),
                    O(" " + y(C.label), 1)
                  ]),
                  _: 2
                }, 1032, ["to", "class"])), 64))
              ])
            ]),
            e("main", je, [
              u.value && !f.value ? (n(), s(L, { key: 0 }, [
                w.value ? (n(), s("div", De, "正在连接 HDSI 数据服务……")) : (n(), s("div", qe, [
                  O(" 数据服务不可用：" + y(o.value) + " ", 1),
                  e("button", {
                    class: "refresh",
                    onClick: i
                  }, "重试")
                ]))
              ], 64)) : (n(), s(L, { key: 1 }, [
                u.value ? (n(), s("div", Ee, [
                  o.value ? (n(), s("span", Ve, "刷新失败：" + y(o.value) + "，当前展示上次快照。", 1)) : p("", !0),
                  e("button", {
                    class: "refresh",
                    disabled: w.value,
                    onClick: i
                  }, y(w.value ? "刷新中……" : "刷新概览"), 9, Le)
                ])) : p("", !0),
                (n(), z(me(r.find((C) => C.id === k.value).component), { overview: f.value }, null, 8, ["overview"]))
              ], 64))
            ])
          ])
        ]),
        _: 1
      });
    };
  }
}), X = (t, r) => {
  const l = t.__vccOpts || t;
  for (const [k, u] of r)
    l[k] = u;
  return l;
}, Re = /* @__PURE__ */ X(Te, [["__scopeId", "data-v-83d18947"]]);
function Fa(t) {
  $e.register("hdsi", {
    render: () => se("svg", {
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
      se("rect", { x: "4", y: "4", width: "10", height: "10", transform: "rotate(45 9 9)" }),
      se("path", { d: "M20 11v9h-9" }),
      se("circle", { cx: "20", cy: "8", r: "2" })
    ])
  }), t.page({
    id: "hdsi",
    path: "/hdsi/:page*",
    name: "HDS Interlude",
    icon: "hdsi",
    order: 600,
    component: Re
  });
}
const Be = ["aria-expanded", "aria-describedby", "onKeydown"], Je = ["id"], ze = { key: 0 }, He = {
  key: 1,
  class: "tip-range"
}, Fe = /* @__PURE__ */ ee({
  name: "InfoDot",
  __name: "InfoDot",
  props: {
    info: {},
    range: {}
  },
  setup(t) {
    const r = g(!1), l = g(null), k = fe();
    let u = 0;
    ve(() => {
      typeof window < "u" && window.addEventListener("scroll", o, !0);
    }), ue(() => {
      typeof window < "u" && window.removeEventListener("scroll", o, !0);
    });
    const f = g({ left: "0px", top: "0px", maxWidth: "320px" });
    async function w(a) {
      const i = a.currentTarget.getBoundingClientRect(), b = Math.min(320, window.innerWidth - 32), S = window.innerHeight - i.bottom > 140;
      f.value = {
        left: `${Math.max(16, Math.min(i.left, window.innerWidth - b - 16))}px`,
        top: `${S ? i.bottom + 8 : Math.max(16, i.top - 140)}px`,
        maxWidth: `${b}px`
      }, r.value = !0;
      const d = ++u;
      if (await pe(), !r.value || d !== u || !l.value) return;
      const P = l.value.getBoundingClientRect().height;
      f.value.top = `${Math.max(8, Math.min(Number.parseFloat(f.value.top), window.innerHeight - P - 8))}px`;
    }
    function o() {
      r.value = !1, u++;
    }
    return (a, m) => (n(), s("button", {
      type: "button",
      class: "info-dot",
      "aria-label": "查看说明（悬停或按住）",
      "aria-expanded": r.value,
      "aria-describedby": r.value ? ne(k) : void 0,
      onMouseenter: w,
      onMouseleave: o,
      onPointerdown: ie(w, ["stop"]),
      onPointerup: o,
      onPointercancel: o,
      onFocus: w,
      onBlur: o,
      onClick: ie(o, ["stop"]),
      onKeydown: [
        oe(o, ["esc"]),
        oe(ie(w, ["prevent"]), ["space"]),
        oe(ie(w, ["prevent"]), ["enter"])
      ],
      onKeyup: [
        oe(o, ["space"]),
        oe(o, ["enter"])
      ]
    }, [
      m[0] || (m[0] = e("svg", {
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
      r.value ? (n(), s("span", {
        key: 0,
        id: ne(k),
        ref_key: "tooltip",
        ref: l,
        class: "hdsi-tip",
        role: "tooltip",
        style: be(f.value)
      }, [
        t.info ? (n(), s("span", ze, y(t.info), 1)) : p("", !0),
        t.range ? (n(), s("span", He, "范围：" + y(t.range), 1)) : p("", !0)
      ], 12, Je)) : p("", !0)
    ], 40, Be));
  }
}), ge = /* @__PURE__ */ X(Fe, [["__scopeId", "data-v-d68b18ae"]]), Ue = {
  name: "DataRow",
  components: { InfoDot: ge },
  props: {
    label: { type: String, required: !0 },
    value: { type: [String, Number, Boolean], default: "—" },
    state: { type: String, default: "" },
    // 'ok' | 'warn' | 'acc'
    info: { type: String, default: "" },
    range: { type: String, default: "" }
  }
}, Ke = { class: "row" }, We = { class: "k" };
function Ye(t, r, l, k, u, f) {
  const w = le("InfoDot");
  return n(), s("div", Ke, [
    e("span", We, [
      O(y(l.label) + " ", 1),
      l.info || l.range ? (n(), z(w, {
        key: 0,
        info: l.info,
        range: l.range
      }, null, 8, ["info", "range"])) : p("", !0)
    ]),
    e("span", {
      class: Q(["v", l.state || void 0])
    }, y(l.value), 3)
  ]);
}
const M = /* @__PURE__ */ X(Ue, [["render", Ye], ["__scopeId", "data-v-4e9413bc"]]), Ge = { key: 0 }, Qe = {
  key: 0,
  class: "notice info"
}, Xe = {
  key: 1,
  class: "notice"
}, Ze = { class: "grid" }, et = { class: "card" }, tt = { class: "card" }, at = { class: "card" }, nt = { class: "card" }, lt = /* @__PURE__ */ ee({
  name: "OverviewPage",
  __name: "OverviewPage",
  props: {
    overview: {}
  },
  setup(t) {
    const r = t, l = { active: "活动中", paused: "已暂停", archived: "已归档" }, k = { asleep: "睡眠", resting: "休息", occupied: "忙碌", available: "空闲", normal: "日常", active: "活跃", "phone-focused": "关注消息", focused: "专注" }, u = F(() => {
      var o, a, m, i;
      return k[(a = (o = r.overview) == null ? void 0 : o.story) == null ? void 0 : a.rhythm] ?? ((i = (m = r.overview) == null ? void 0 : m.story) == null ? void 0 : i.rhythm) ?? "未建立";
    }), f = { main: "主叙事", compaction: "记忆整理", timeline: "时间导演", alter: "情绪分析", embedding: "向量检索", stickers: "表情包描述", vision: "视觉理解", research: "考据检索" }, w = {
      allowProactiveMessages: "主角可主动发起可见消息（非回复式）",
      urge: "依据生活节奏和对话密度安排后台补写；人物是否联系他人由主叙事形成动作",
      sceneConditions: "设备、隐私和负荷的有效场景证据；缺失或过期时显示未知",
      deliveryPolicy: "管理员设置的主动出站运行额度和间隔；人物动机由主叙事决定",
      research: "考据 Agent：人物形成查证动作后，后台核实并写入考据案头，供后续写作参考",
      jev: "生活推进前的外部考据判定；命中时先检索资料，再继续写作"
    };
    return (o, a) => {
      var m;
      return t.overview ? (n(), s("div", Ge, [
        a[6] || (a[6] = e("div", { class: "pg-head" }, [
          e("div", null, [
            e("h2", null, "概览"),
            e("div", { class: "sub" }, "当前故事 · 模型用途 · 运行边界 · 考据状态")
          ])
        ], -1)),
        (m = t.overview.story) != null && m.found ? (n(), s("div", Qe, [
          e("b", null, y(t.overview.story.characterName), 1),
          O(" · " + y(l[t.overview.story.status] ?? t.overview.story.status) + " · 当前节奏 " + y(u.value) + "。剧情时间 ", 1),
          e("code", null, y(t.overview.story.cursorLocal), 1),
          a[0] || (a[0] = O("，共 ", -1)),
          e("b", null, y(t.overview.story.entryCount), 1),
          a[1] || (a[1] = O(" 条剧本记录。 ", -1))
        ])) : (n(), s("div", Xe, "当前还没有故事。先在配置中心填写故事档案和模型，再从聊天启动故事。")),
        e("div", Ze, [
          e("div", et, [
            a[2] || (a[2] = e("h3", null, [
              e("span", { class: "sq" }),
              O("故事状态")
            ], -1)),
            A(M, {
              label: "主角",
              value: t.overview.story.characterName || "—",
              info: "主角姓名，出现在全部叙事中",
              range: "任意非空中文/英文"
            }, null, 8, ["value"]),
            A(M, {
              label: "关系人数",
              value: t.overview.story.participantCount,
              info: "已登记的参与者（跨会话共享同一故事）"
            }, null, 8, ["value"]),
            A(M, {
              label: "故事状态",
              value: l[t.overview.story.status] ?? t.overview.story.status,
              state: t.overview.story.status === "active" ? "ok" : "",
              info: "active=活动 / paused=暂停 / archived=归档"
            }, null, 8, ["value", "state"]),
            A(M, {
              label: "节奏",
              value: u.value,
              state: "acc",
              info: "主角当前的生活节奏/注意力，由时间与近况推得"
            }, null, 8, ["value"])
          ]),
          e("div", tt, [
            a[3] || (a[3] = e("h3", null, [
              e("span", { class: "sq" }),
              O("模型连接")
            ], -1)),
            (n(!0), s(L, null, Z(t.overview.models, (i) => (n(), z(M, {
              key: i.task,
              label: f[i.task] ?? i.task,
              value: `${i.provider} · ${i.model}`,
              state: i.available ? "ok" : i.reason === "disabled" ? "" : "warn",
              info: "按模型中心的用途配置解析出的连接与模型；该状态表示配置匹配，不表示网络探活成功"
            }, null, 8, ["label", "value", "state"]))), 128))
          ]),
          e("div", at, [
            a[4] || (a[4] = e("h3", null, [
              e("span", { class: "sq" }),
              O("系统开关")
            ], -1)),
            (n(!0), s(L, null, Z(t.overview.switches, (i) => (n(), z(M, {
              key: i.key,
              label: i.label,
              value: i.value,
              state: i.ok === !0 ? "ok" : i.ok === !1 ? "warn" : "",
              info: w[i.key]
            }, null, 8, ["label", "value", "state", "info"]))), 128))
          ]),
          e("div", nt, [
            a[5] || (a[5] = e("h3", null, [
              e("span", { class: "sq" }),
              O("考据 Agent")
            ], -1)),
            A(M, {
              label: "状态",
              value: t.overview.research.enabled ? "开启" : "关闭",
              state: t.overview.research.enabled ? "ok" : "",
              info: "考据总开关，可在配置中心的「考据 Agent」中修改"
            }, null, 8, ["value", "state"]),
            A(M, {
              label: "搜索后端",
              value: t.overview.research.backend,
              state: "acc",
              info: "考据检索的网络后端",
              range: "auto/tavily/bocha/searxng/duckduckgo-html"
            }, null, 8, ["value"]),
            A(M, {
              label: "案头条目",
              value: t.overview.research.deskEntries,
              info: "在架的核实事实数（稳定+易变，TTL 过期淘汰）",
              range: "案头容量 2-32"
            }, null, 8, ["value"]),
            A(M, {
              label: "写入 / 复用",
              value: `${t.overview.research.counters.offered} / ${t.overview.research.counters.reused}`,
              info: "累计写入案头 / 复用已有条目（重载归零）"
            }, null, 8, ["value"]),
            A(M, {
              label: "Jev 门控",
              value: t.overview.research.jev.enabled ? t.overview.research.jev.keyConfigured ? `判定 ${t.overview.research.jev.calls} / 触发 ${t.overview.research.jev.triggered}` : "已开启 · 待配置密钥" : "未启用",
              state: t.overview.research.jev.enabled ? t.overview.research.jev.keyConfigured ? "ok" : "warn" : "",
              info: "判定=门控调用次数，触发=判定 TRUE 放行先查后写"
            }, null, 8, ["value", "state"])
          ])
        ])
      ])) : p("", !0);
    };
  }
}), ot = /* @__PURE__ */ X(lt, [["__scopeId", "data-v-870eac41"]]), st = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ot
}, Symbol.toStringTag, { value: "Module" })), it = { class: "cc" }, rt = ["disabled"], ut = {
  key: 1,
  class: "hint"
}, vt = { class: "layout" }, dt = {
  class: "menu",
  "aria-label": "配置分类"
}, ct = { class: "search" }, ft = {
  key: 0,
  class: "menu-summary"
}, yt = { class: "group" }, ht = ["aria-current", "disabled", "onClick"], gt = {
  key: 1,
  class: "hint"
}, mt = { class: "content" }, bt = {
  key: 0,
  class: "hint"
}, pt = {
  key: 1,
  class: "card"
}, kt = { class: "hint" }, wt = { class: "actions" }, _t = {
  class: "save-state",
  role: "status"
}, $t = ["disabled"], St = ["disabled"], xt = ["disabled"], Ct = {
  key: 2,
  class: "hint"
}, Mt = {
  key: 3,
  class: "hint"
}, It = /* @__PURE__ */ ee({
  name: "ConfigCenterPage",
  __name: "ConfigCenterPage",
  props: {
    overview: {}
  },
  setup(t) {
    const r = {
      blindMode: ["enabled"]
    }, l = g(""), k = g([]), u = g(""), f = g(null), w = g(null), o = g({}), a = g({}), m = g([]), i = g(!1), b = g(!1), S = g(!1), d = g(!1), P = g(""), C = g("ok"), B = g("");
    let H = 0, V = !1;
    ue(() => {
      V = !0, H++;
    });
    const j = F(() => k.value.flatMap((h) => h.sections.filter((c) => c.stage === 1))), D = F(() => B.value === u.value && JSON.stringify(o.value) !== JSON.stringify(a.value)), J = F(() => k.value.map((h) => ({ ...h, sections: h.sections.filter((c) => `${c.label} ${c.id} ${c.description}`.toLowerCase().includes(l.value.trim().toLowerCase())) })).filter((h) => h.sections.length)), I = () => !D.value || window.confirm("配置中心有未保存的修改。离开此页面？");
    ye(I), he((h, c) => h.path === c.path || I());
    async function T(h) {
      h === u.value || d.value || D.value && !window.confirm("本节有尚未保存的修改。切换配置节将重新读取，继续切换？") || await v(h);
    }
    async function x() {
      i.value || d.value || !u.value || D.value && !window.confirm("重新读取将以已保存配置替换本节的未保存修改。继续？") || await v(u.value);
    }
    function U(h, c, N = "") {
      return Object.keys(h).flatMap((E) => {
        const K = N ? `${N}.${E}` : E;
        if (!(E in c)) return [K];
        const q = h[E], Y = c[E];
        return q && Y && typeof q == "object" && typeof Y == "object" && !Array.isArray(q) && !Array.isArray(Y) ? U(q, Y, K) : [];
      });
    }
    function _(h) {
      for (const c of k.value) {
        const N = c.sections.find((E) => E.id === h);
        if (N) return N;
      }
    }
    async function $() {
      if (!(V || b.value)) {
        b.value = !0, S.value = !1, P.value = "";
        try {
          const h = await W.readConfigCenter();
          if (V) return;
          if (!(h != null && h.ok) || !Array.isArray(h.menu)) throw new Error((h == null ? void 0 : h.error) ?? "菜单读取失败");
          k.value = h.menu;
          const c = j.value.find((N) => N.id === "runtime") ?? j.value[0];
          c && await v(c.id);
        } catch (h) {
          V || (S.value = !0, P.value = `配置菜单读取失败：${(h == null ? void 0 : h.message) ?? String(h)}`, C.value = "warn");
        } finally {
          V || (b.value = !1);
        }
      }
    }
    async function v(h, c = !1) {
      const N = _(h);
      if (V || !N || N.stage !== 1) return;
      const E = ++H, K = () => !V && E === H && u.value === h;
      u.value = h, f.value = N, B.value = "", w.value = null, o.value = {}, a.value = {}, m.value = [], i.value = !0, c || (P.value = "");
      try {
        const q = await W.readConfigCenter(h);
        if (!K()) return;
        if (!q.ok) throw new Error(q.error ?? "读取失败");
        if (!q.schema) throw new Error("配置结构读取失败");
        w.value = new xe(q.schema);
        const Y = q.values ?? {};
        o.value = JSON.parse(JSON.stringify(Y)), a.value = JSON.parse(JSON.stringify(Y)), m.value = q.maskedFields ?? [], B.value = h;
      } catch (q) {
        K() && (P.value = `${c ? "配置已保存，重新读取失败：" : ""}${(q == null ? void 0 : q.message) ?? String(q)}`, C.value = "warn");
      } finally {
        K() && (i.value = !1);
      }
    }
    function R() {
      return (r[u.value] ?? []).filter((c) => JSON.stringify(o.value[c]) !== JSON.stringify(a.value[c]));
    }
    async function de(h = !1) {
      if (V || d.value || i.value || !u.value || B.value !== u.value) return;
      const c = u.value, N = H, E = () => !V && N === H && u.value === c, K = JSON.stringify(o.value), q = JSON.parse(K), Y = R();
      if (!(Y.length && !window.confirm(`本次保存将修改影响排障能力的字段：${Y.join("、")}。
盲区模式开启后将关闭管理指令并隐藏运行日志，恢复需在 Koishi 配置中关闭该开关并重载。

确认继续？`))) {
        d.value = !0, P.value = "";
        try {
          const te = await W.saveConfigCenter(c, q, { reload: h, unset: U(a.value, q) });
          if (!E()) return;
          if (!te.ok) throw new Error(te.error ?? "未知错误");
          P.value = h ? "已保存，并已请求重载 HDSI。" : "已保存到 koishi.yml；配置更新已提交，插件将按需自动重载。", C.value = "ok", JSON.stringify(o.value) === K ? await v(c, !0) : a.value = JSON.parse(K);
        } catch (te) {
          E() && (P.value = `保存失败：${(te == null ? void 0 : te.message) ?? String(te)}`, C.value = "warn");
        } finally {
          V || (d.value = !1);
        }
      }
    }
    return ve($), (h, c) => (n(), s("div", it, [
      c[8] || (c[8] = e("div", { class: "pg-head" }, [
        e("div", null, [
          e("h2", null, "配置中心"),
          e("div", { class: "sub" }, "按用途管理故事档案、模型、上下文与运行能力。修改仅在保存后写入配置文件。")
        ])
      ], -1)),
      P.value ? (n(), s("div", {
        key: 0,
        class: Q(["notice", C.value]),
        role: "status"
      }, [
        O(y(P.value) + " ", 1),
        S.value ? (n(), s("button", {
          key: 0,
          class: "save",
          disabled: b.value,
          onClick: $
        }, "重试", 8, rt)) : p("", !0)
      ], 2)) : p("", !0),
      b.value && !k.value.length ? (n(), s("div", ut, "读取配置菜单……")) : p("", !0),
      e("div", vt, [
        e("aside", dt, [
          e("label", ct, [
            c[5] || (c[5] = e("span", null, "查找配置", -1)),
            ke(e("input", {
              "onUpdate:modelValue": c[0] || (c[0] = (N) => l.value = N),
              type: "search",
              placeholder: "名称或字段，如 runtime",
              "aria-label": "查找配置节"
            }, null, 512), [
              [we, l.value]
            ])
          ]),
          k.value.length ? (n(), s("div", ft, y(j.value.length) + " 个配置节 · 全部可编辑", 1)) : p("", !0),
          (n(!0), s(L, null, Z(J.value, (N) => (n(), s(L, {
            key: N.id
          }, [
            e("div", yt, y(N.label), 1),
            (n(!0), s(L, null, Z(N.sections, (E) => (n(), s("button", {
              key: E.id,
              type: "button",
              class: Q(["item", { on: u.value === E.id }]),
              "aria-current": u.value === E.id ? "page" : void 0,
              disabled: d.value,
              onClick: (K) => T(E.id)
            }, y(E.label), 11, ht))), 128))
          ], 64))), 128)),
          l.value && !J.value.length ? (n(), s("div", gt, "没有匹配的配置节。")) : p("", !0)
        ]),
        e("main", mt, [
          i.value ? (n(), s("div", bt, "读取中……")) : f.value && w.value ? (n(), s("div", pt, [
            e("h3", null, [
              c[6] || (c[6] = e("span", { class: "sq" }, null, -1)),
              O(y(f.value.label), 1)
            ]),
            e("div", kt, [
              O(y(f.value.description), 1),
              m.value.length ? (n(), s(L, { key: 0 }, [
                O(" 密钥已隐藏，保持占位值可保留原密钥；填写新值可替换。")
              ], 64)) : p("", !0)
            ]),
            (n(), z(ne(Se).Form, {
              onSubmit: c[1] || (c[1] = ie(() => {
              }, ["prevent"])),
              key: B.value,
              inert: d.value || void 0,
              "aria-busy": d.value,
              schema: w.value,
              "model-value": o.value,
              initial: a.value,
              "onUpdate:modelValue": c[2] || (c[2] = (N) => o.value = N)
            }, null, 8, ["inert", "aria-busy", "schema", "model-value", "initial"])),
            e("div", wt, [
              e("span", _t, y(d.value ? "正在写入配置…" : D.value ? "有未保存的修改" : "与已读取配置一致"), 1),
              e("button", {
                class: "secondary",
                type: "button",
                disabled: d.value || i.value,
                onClick: x
              }, "重新读取", 8, $t),
              e("button", {
                class: "save",
                type: "button",
                disabled: d.value || i.value || B.value !== u.value,
                onClick: c[3] || (c[3] = (N) => de(!1))
              }, y(d.value ? "保存中……" : "保存本节"), 9, St),
              e("button", {
                class: "secondary",
                type: "button",
                disabled: d.value || i.value || B.value !== u.value,
                onClick: c[4] || (c[4] = (N) => de(!0))
              }, "保存并重载", 8, xt)
            ])
          ])) : !i.value && u.value ? (n(), s("div", Ct, [
            c[7] || (c[7] = O("本节读取失败。", -1)),
            e("button", {
              class: "secondary",
              onClick: x
            }, "重新读取")
          ])) : !i.value && k.value.length ? (n(), s("div", Mt, "选择配置节以查看和编辑。")) : p("", !0)
        ])
      ])
    ]));
  }
}), At = /* @__PURE__ */ X(It, [["__scopeId", "data-v-10c1f819"]]), Ot = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: At
}, Symbol.toStringTag, { value: "Module" })), Pt = {
  name: "EditField",
  components: { InfoDot: ge },
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
    return { inputId: fe() };
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
}, Nt = { class: "field" }, jt = ["for"], Dt = { class: "field-input" }, qt = ["id", "value", "placeholder"], Et = ["id", "value"], Vt = ["value"], Lt = ["id", "aria-checked", "aria-label"], Tt = ["id", "value", "min", "max"], Rt = ["id", "type", "value", "placeholder"];
function Bt(t, r, l, k, u, f) {
  const w = le("InfoDot");
  return n(), s("div", Nt, [
    e("label", {
      class: "field-label",
      for: k.inputId
    }, [
      O(y(l.label) + " ", 1),
      l.info || l.range ? (n(), z(w, {
        key: 0,
        info: l.info,
        range: l.range
      }, null, 8, ["info", "range"])) : p("", !0)
    ], 8, jt),
    e("div", Dt, [
      l.textarea ? (n(), s("textarea", {
        key: 0,
        id: k.inputId,
        value: String(l.modelValue ?? ""),
        placeholder: l.placeholder,
        class: "input area",
        onInput: r[0] || (r[0] = (o) => t.$emit("update:modelValue", o.target.value))
      }, null, 40, qt)) : l.type === "select" ? (n(), s("select", {
        key: 1,
        id: k.inputId,
        value: String(l.modelValue),
        class: "input",
        onChange: r[1] || (r[1] = (o) => t.$emit("update:modelValue", o.target.value))
      }, [
        (n(!0), s(L, null, Z(l.options, (o) => (n(), s("option", {
          key: o.value,
          value: o.value
        }, y(o.label), 9, Vt))), 128))
      ], 40, Et)) : l.type === "boolean" ? (n(), s("button", {
        key: 2,
        id: k.inputId,
        type: "button",
        role: "switch",
        "aria-checked": !!l.modelValue,
        "aria-label": l.label,
        class: Q(["toggle", { on: l.modelValue }]),
        onClick: r[2] || (r[2] = (...o) => f.onBool && f.onBool(...o))
      }, [...r[6] || (r[6] = [
        e("span", { class: "toggle-dot" }, null, -1)
      ])], 10, Lt)) : l.type === "number" ? (n(), s("input", {
        key: 3,
        id: k.inputId,
        type: "number",
        value: Number(l.modelValue),
        min: l.min,
        max: l.max,
        class: "input",
        onInput: r[3] || (r[3] = (o) => t.$emit("update:modelValue", Number(o.target.value)))
      }, null, 40, Tt)) : (n(), s("input", {
        key: 4,
        id: k.inputId,
        type: l.secret && !u.visible ? "password" : "text",
        value: String(l.modelValue ?? ""),
        placeholder: l.placeholder,
        class: "input",
        onInput: r[4] || (r[4] = (o) => t.$emit("update:modelValue", o.target.value))
      }, null, 40, Rt)),
      l.secret ? (n(), s("button", {
        key: 5,
        type: "button",
        class: "reveal",
        onClick: r[5] || (r[5] = (o) => u.visible = !u.visible)
      }, y(u.visible ? "隐藏" : "显示"), 1)) : p("", !0)
    ])
  ]);
}
const Jt = /* @__PURE__ */ X(Pt, [["render", Bt], ["__scopeId", "data-v-47b39beb"]]), zt = {
  key: 1,
  class: "notice warn"
}, Ht = { class: "card" }, Ft = { class: "hint" }, Ut = {
  key: 0,
  class: "hint"
}, Kt = { class: "actions" }, Wt = ["disabled"], Yt = ["disabled"], Gt = /* @__PURE__ */ ee({
  name: "ConfigPage",
  __name: "ConfigPage",
  props: {
    overview: {}
  },
  setup(t) {
    const r = [
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
    ], l = g("story"), k = () => r.find((j) => j.id === l.value), u = _e({}), f = g(!1), w = g(!1), o = g(""), a = g("ok"), m = g(""), i = F(() => !!d.value && JSON.stringify(u) !== m.value), b = () => !i.value || window.confirm("当前故事有未保存的修改。离开此页面？");
    ye(b), he((j, D) => j.path === D.path || b());
    async function S() {
      i.value && !window.confirm("重新读取将使用服务器上的故事设定替换当前修改。继续？") || await B(l.value);
    }
    const d = g("");
    let P = 0, C = !1;
    ue(() => {
      C = !0, P++;
    });
    async function B(j) {
      var T;
      const D = r.find((x) => x.id === j);
      if (C || !D) return;
      const J = ++P, I = () => !C && J === P && l.value === j;
      l.value = j, d.value = "";
      for (const x of Object.keys(u)) delete u[x];
      f.value = !0, o.value = "";
      try {
        const x = await W.readConfig(j);
        if (!x) throw new Error("Console 连接尚未就绪");
        if (!x.ok) throw new Error(x.error ?? "读取失败");
        if (!I()) return;
        for (const U of D.fields) {
          const _ = (T = x.values) == null ? void 0 : T[U.key];
          u[U.key] = U.type === "boolean" ? _ === !0 : _ ?? (U.type === "number" ? 0 : "");
        }
        m.value = JSON.stringify(u), d.value = j;
      } catch (x) {
        I() && (o.value = (x == null ? void 0 : x.message) ?? String(x), a.value = "warn");
      } finally {
        I() && (f.value = !1);
      }
    }
    async function H() {
      if (C || w.value || f.value || d.value !== l.value) return;
      const j = l.value, D = P, J = () => !C && D === P && l.value === j, I = {};
      for (const x of k().fields) I[x.key] = u[x.key];
      const T = JSON.parse(JSON.stringify(I));
      w.value = !0, o.value = "";
      try {
        const x = await W.saveConfig(j, T);
        if (!J()) return;
        if (!x.ok) throw new Error(x.error ?? "未知错误");
        m.value = JSON.stringify(T), o.value = `已写入 ${x.applied ?? 0} 项。${j === "story" ? "已保存到当前故事，后续写作立即使用。" : "已写入 koishi.yml，插件热更新生效。"}`, a.value = "ok";
      } catch (x) {
        J() && (o.value = `保存失败：${(x == null ? void 0 : x.message) ?? String(x)}`, a.value = "warn");
      } finally {
        C || (w.value = !1);
      }
    }
    const V = () => l.value === "story" && d.value === "story" && !u["character.name"] && !f.value;
    return ve(() => B("story")), (j, D) => {
      const J = le("router-link");
      return n(), s("div", null, [
        D[2] || (D[2] = e("div", { class: "pg-head" }, [
          e("div", null, [
            e("h2", null, "当前故事"),
            e("div", { class: "sub" }, "编辑当前故事的设定，保存到故事数据库。新故事的默认档案在配置中心设置。")
          ])
        ], -1)),
        A(J, {
          to: "/hdsi/config-center",
          class: "redirect-card"
        }, {
          default: re(() => [...D[0] || (D[0] = [
            O("模型、上下文预算、运行时与考据设置 → 配置中心", -1)
          ])]),
          _: 1
        }),
        o.value ? (n(), s("div", {
          key: 0,
          class: Q(["notice", a.value]),
          role: "status"
        }, y(o.value), 3)) : p("", !0),
        V() ? (n(), s("div", zt, "当前没有活跃故事——先在聊天里用 interlude.story.start 启动，再回来编辑故事设定。")) : p("", !0),
        e("div", Ht, [
          e("h3", null, [
            D[1] || (D[1] = e("span", { class: "sq" }, null, -1)),
            O(y(k().label), 1)
          ]),
          e("div", Ft, y(k().hint), 1),
          f.value ? (n(), s("div", Ut, "读取中……")) : d.value === l.value && !V() ? (n(), s(L, { key: 1 }, [
            (n(!0), s(L, null, Z(k().fields, (I) => (n(), z(Jt, {
              key: I.key,
              modelValue: u[I.key],
              "onUpdate:modelValue": (T) => u[I.key] = T,
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
            e("div", Kt, [
              e("button", {
                class: "refresh",
                disabled: f.value || w.value,
                onClick: S
              }, "重新读取", 8, Wt),
              e("button", {
                class: "save",
                disabled: w.value || f.value || d.value !== l.value,
                onClick: H
              }, y(w.value ? "写入中……" : "保存故事设定"), 9, Yt)
            ])
          ], 64)) : (n(), s("button", {
            key: 2,
            type: "button",
            class: "save",
            onClick: S
          }, "重新读取"))
        ])
      ]);
    };
  }
}), Qt = /* @__PURE__ */ X(Gt, [["__scopeId", "data-v-8946789c"]]), Xt = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Qt
}, Symbol.toStringTag, { value: "Module" })), Zt = { key: 0 }, ea = { class: "grid" }, ta = { class: "card" }, aa = { class: "card" }, na = {
  key: 0,
  class: "notice info",
  style: { "margin-top": "8px" }
}, la = /* @__PURE__ */ ee({
  name: "DeskPage",
  __name: "DeskPage",
  props: {
    overview: {}
  },
  setup(t) {
    return (r, l) => t.overview ? (n(), s("div", Zt, [
      l[2] || (l[2] = e("div", { class: "pg-head" }, [
        e("div", null, [
          e("h2", null, "考据案头"),
          e("div", { class: "sub" }, "经核实的写作参考；资料可供作者使用，主角知情范围由剧情证据决定。")
        ])
      ], -1)),
      e("div", ea, [
        e("div", ta, [
          l[0] || (l[0] = e("h3", null, [
            e("span", { class: "sq" }),
            O("案头概况")
          ], -1)),
          A(M, {
            label: "在架条目",
            value: t.overview.research.deskEntries,
            info: "在架的核实事实数（稳定+易变，TTL 过期淘汰）",
            range: "案头容量 2-32，默认 8"
          }, null, 8, ["value"]),
          A(M, {
            label: "搜索后端",
            value: t.overview.research.backend,
            state: "acc",
            info: "考据检索的网络后端",
            range: "auto/tavily/bocha/searxng/duckduckgo-html"
          }, null, 8, ["value"]),
          A(M, {
            label: "查询缓存",
            value: `${t.overview.research.cache.size} 条（命中 ${t.overview.research.cache.hits} / 未命中 ${t.overview.research.cache.misses}）`,
            info: "搜索查询结果缓存——命中可省一次网络检索"
          }, null, 8, ["value"]),
          A(M, {
            label: "累计写入 / 复用 / 淘汰",
            value: `${t.overview.research.counters.offered} / ${t.overview.research.counters.reused} / ${t.overview.research.counters.evicted}`,
            info: "写入案头 / 复用已有条目 / 容量与 TTL 淘汰（重载归零）"
          }, null, 8, ["value"])
        ]),
        e("div", aa, [
          l[1] || (l[1] = e("h3", null, [
            e("span", { class: "sq" }),
            O("Jev 决策门控")
          ], -1)),
          A(M, {
            label: "状态",
            value: t.overview.research.jev.enabled ? t.overview.research.jev.keyConfigured ? "已启用" : "已开启 · 待配置密钥" : "未启用",
            state: t.overview.research.jev.enabled ? t.overview.research.jev.keyConfigured ? "ok" : "warn" : "",
            info: "自动生活推进前的考据判定；同时受考据总开关控制"
          }, null, 8, ["value", "state"]),
          A(M, {
            label: "判定 / 触发",
            value: `${t.overview.research.jev.calls} / ${t.overview.research.jev.triggered}`,
            info: "判定=门控调用次数，触发=判定 TRUE 放行先查后写（重载归零）"
          }, null, 8, ["value"]),
          t.overview.research.jev.enabled ? p("", !0) : (n(), s("div", na, "如需在生活推进前判定是否查证，可在配置中心的「考据 Agent」中配置 Jev 密钥并启用门控。"))
        ])
      ]),
      l[3] || (l[3] = e("div", {
        class: "notice info",
        style: { "margin-top": "12px" }
      }, "当前页展示案头数量、缓存与门控的汇总状态；资料的使用情况可结合写作记录和考据日志核对。", -1))
    ])) : p("", !0);
  }
}), oa = /* @__PURE__ */ X(la, [["__scopeId", "data-v-9c6e59c1"]]), sa = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: oa
}, Symbol.toStringTag, { value: "Module" })), ia = { class: "pg-head" }, ra = { class: "sub" }, ua = ["disabled"], va = {
  key: 0,
  class: "error",
  role: "alert"
}, da = {
  key: 1,
  class: "notice",
  role: "status"
}, ca = {
  key: 2,
  class: "empty"
}, fa = {
  key: 3,
  class: "empty"
}, ya = { class: "list" }, ha = ["aria-expanded", "disabled", "onClick"], ga = ["data-kind"], ma = { class: "target" }, ba = { class: "head" }, pa = ["data-status"], ka = { class: "time" }, wa = {
  key: 0,
  class: "detail"
}, _a = { key: 0 }, $a = {
  key: 4,
  class: "quote"
}, Sa = {
  key: 5,
  class: "ops"
}, xa = {
  key: 0,
  class: "verify-hint"
}, Ca = ["disabled"], Ma = ["disabled"], Ia = ["disabled"], Aa = ["onClick"], Oa = ["disabled"], Pa = /* @__PURE__ */ ee({
  name: "ActionsPage",
  __name: "ActionsPage",
  setup(t) {
    const r = g([]), l = g(0), k = g(void 0), u = g(!1), f = g(""), w = g(""), o = g(""), a = g(null), m = g(!1), i = g(!1);
    let b = !1, S = 0, d = 0;
    const P = { action: "当前动作", plan: "人物计划", "fixed-delay": "确定延迟" }, C = {
      pending: "待执行",
      delivered: "已送达",
      partial: "部分送达",
      failed: "失败",
      cancelled: "已取消",
      unknown: "待核实",
      "pending-plan": "计划待处理"
    }, B = F(() => a.value ? a.value.kind !== "action" ? !0 : a.value.segments.some((_) => _.status === "pending" || _.status === "unknown") : !1), H = F(() => {
      var _;
      return !!((_ = a.value) != null && _.segments.some(($) => $.status === "unknown"));
    }), V = {
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
    }, j = {
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
    function D(_) {
      return j[_] ? `${j[_]}（${_}）` : _;
    }
    async function J(_) {
      if (i.value) return;
      const $ = o.value;
      i.value = !0, w.value = "", f.value = "";
      try {
        const v = await _();
        if (b) return;
        if (!v.ok) throw new Error(V[v.reason] ?? v.reason ?? "操作失败");
        w.value = V[v.reason] ?? (v.changed ? "操作已完成。" : "状态已经更新，本次无需变更。"), v.changed > 0 && (await T(!0), !b && o.value === $ && await I($));
      } catch (v) {
        b || (f.value = v instanceof Error ? v.message : String(v));
      } finally {
        b || (i.value = !1);
      }
    }
    async function I(_) {
      f.value = "";
      const $ = ++d;
      m.value = !0, a.value = null;
      try {
        const v = await W.actionDetail(_);
        if (b || $ !== d || o.value !== _) return;
        if (!v) throw new Error("该动作已不在当前记录中，请刷新列表。");
        a.value = v;
      } catch (v) {
        !b && $ === d && (f.value = v instanceof Error ? v.message : String(v));
      } finally {
        !b && $ === d && (m.value = !1);
      }
    }
    async function T(_ = !0) {
      const $ = ++S;
      u.value = !0, f.value = "";
      try {
        const v = await W.actionsList(_ ? void 0 : k.value);
        if (!v) throw new Error("Console 连接尚未就绪");
        if (b || $ !== S) return;
        r.value = _ ? v.rows : [...r.value, ...v.rows], l.value = v.total, k.value = v.cursor, _ && o.value && !r.value.some((R) => R.id === o.value) && (o.value = "", a.value = null, d++, m.value = !1);
      } catch (v) {
        !b && $ === S && (f.value = String(v));
      } finally {
        !b && $ === S && (u.value = !1);
      }
    }
    async function x(_) {
      if (!i.value) {
        if (f.value = "", w.value = "", o.value === _) {
          o.value = "", a.value = null, d++, m.value = !1;
          return;
        }
        o.value = _, await I(_);
      }
    }
    function U(_) {
      if (!_) return "—";
      const $ = new Date(_);
      return Number.isNaN($.getTime()) ? "—" : $.toLocaleString();
    }
    return ve(() => void T()), ue(() => {
      b = !0, S++, d++;
    }), (_, $) => (n(), s("div", null, [
      e("div", ia, [
        e("div", null, [
          $[5] || ($[5] = e("h2", null, "通信动作", -1)),
          e("div", ra, "查看作者动作、投递结果与未来计划；管理员可取消后续分段或核实未知回执。当前窗口共 " + y(l.value) + " 条。", 1)
        ]),
        e("button", {
          class: "refresh",
          disabled: u.value,
          onClick: $[0] || ($[0] = (v) => T(!0))
        }, "刷新", 8, ua)
      ]),
      f.value ? (n(), s("div", va, y(f.value), 1)) : p("", !0),
      w.value ? (n(), s("div", da, y(w.value), 1)) : p("", !0),
      u.value && !r.value.length ? (n(), s("div", ca, "正在读取通信动作…")) : p("", !0),
      !u.value && !r.value.length && !f.value ? (n(), s("div", fa, "暂无动作记录。")) : p("", !0),
      e("div", ya, [
        (n(!0), s(L, null, Z(r.value, (v) => (n(), s("div", {
          key: v.id,
          class: Q(["row", { open: o.value === v.id }])
        }, [
          e("button", {
            type: "button",
            class: "row-main",
            "aria-expanded": o.value === v.id,
            disabled: i.value,
            onClick: (R) => x(v.id)
          }, [
            e("span", {
              class: "kind",
              "data-kind": v.kind
            }, y(P[v.kind] ?? v.kind), 9, ga),
            e("span", ma, y(v.target), 1),
            e("span", ba, y(v.head), 1),
            e("span", {
              class: "status",
              "data-status": v.status
            }, [
              O(y(C[v.status] ?? v.status), 1),
              v.segmentCount ? (n(), s(L, { key: 0 }, [
                O("（" + y(v.deliveredCount) + "/" + y(v.segmentCount) + "）", 1)
              ], 64)) : p("", !0)
            ], 8, pa),
            e("span", ka, y(U(v.updatedAt)), 1)
          ], 8, ha),
          o.value === v.id ? (n(), s("div", wa, [
            m.value ? (n(), s("div", _a, "读取中…")) : a.value ? (n(), s(L, { key: 1 }, [
              A(M, {
                label: "动作",
                value: a.value.id
              }, null, 8, ["value"]),
              A(M, {
                label: "渠道",
                value: a.value.channel === "group" ? "群聊" : "私聊"
              }, null, 8, ["value"]),
              a.value.dueAt ? (n(), z(M, {
                key: 0,
                label: "到期",
                value: U(a.value.dueAt)
              }, null, 8, ["value"])) : p("", !0),
              a.value.expiresAt ? (n(), z(M, {
                key: 1,
                label: "失效",
                value: U(a.value.expiresAt)
              }, null, 8, ["value"])) : p("", !0),
              a.value.reason ? (n(), z(M, {
                key: 2,
                label: "原因",
                value: D(a.value.reason)
              }, null, 8, ["value"])) : p("", !0),
              a.value.segments.length ? (n(), z(M, {
                key: 3,
                label: "分段",
                value: a.value.segments.map((R) => `第 ${R.index + 1} 段：${C[R.status] ?? R.status}${R.reason ? `（${D(R.reason)}）` : ""}`).join("；") || "—"
              }, null, 8, ["value"])) : p("", !0),
              a.value.quote ? (n(), s("div", $a, "原文：" + y(a.value.quote), 1)) : p("", !0),
              B.value || H.value ? (n(), s("div", Sa, [
                H.value ? (n(), s("p", xa, "根据平台实际记录核实；确认送达后，该结果会作为后续写作依据。")) : p("", !0),
                B.value ? (n(), s("button", {
                  key: 1,
                  disabled: i.value,
                  onClick: $[1] || ($[1] = (R) => J(() => ne(W).cancelAction(a.value.id)))
                }, y(i.value ? "处理中…" : "取消后续"), 9, Ca)) : p("", !0),
                H.value ? (n(), s("button", {
                  key: 2,
                  disabled: i.value,
                  class: "ok",
                  onClick: $[2] || ($[2] = (R) => J(() => ne(W).verifyAction(a.value.id, "delivered")))
                }, "核实已送达", 8, Ma)) : p("", !0),
                H.value ? (n(), s("button", {
                  key: 3,
                  disabled: i.value,
                  onClick: $[3] || ($[3] = (R) => J(() => ne(W).verifyAction(a.value.id, "not-sent")))
                }, "核实未发送", 8, Ia)) : p("", !0)
              ])) : p("", !0)
            ], 64)) : (n(), s("button", {
              key: 2,
              class: "refresh",
              onClick: (R) => I(v.id)
            }, "重试读取详情", 8, Aa))
          ])) : p("", !0)
        ], 2))), 128))
      ]),
      k.value ? (n(), s("button", {
        key: 4,
        class: "more",
        disabled: u.value,
        onClick: $[4] || ($[4] = (v) => T(!1))
      }, y(u.value ? "读取中…" : "加载更多"), 9, Oa)) : p("", !0)
    ]));
  }
}), Na = /* @__PURE__ */ X(Pa, [["__scopeId", "data-v-3a8f7733"]]), ja = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Na
}, Symbol.toStringTag, { value: "Module" })), Da = { key: 0 }, qa = { class: "scope-controls" }, Ea = { class: "grid" }, Va = { class: "card" }, La = { class: "card" }, Ta = /* @__PURE__ */ ee({
  name: "DensityPage",
  __name: "DensityPage",
  props: {
    overview: {}
  },
  setup(t) {
    const r = t, l = g("private"), k = { burst: "极高密度", high: "高密度", normal: "日常", low: "低密度", advance: "自动推进" }, u = F(() => {
      var a, m, i, b, S, d, P, C;
      const o = (b = (i = (m = (a = r.overview) == null ? void 0 : a.density) == null ? void 0 : m.scopes) == null ? void 0 : i[l.value]) == null ? void 0 : b.mode;
      return o && o !== "inherit" ? o : ((d = (S = r.overview) == null ? void 0 : S.density) == null ? void 0 : d.globalMode) ?? ((C = (P = r.overview) == null ? void 0 : P.density) == null ? void 0 : C.mode) ?? "fixed";
    }), f = F(() => {
      var m, i, b;
      const o = ((m = r.overview) == null ? void 0 : m.density) ?? {}, a = ((b = (i = o.scopes) == null ? void 0 : i[l.value]) == null ? void 0 : b.tiers) ?? {};
      return [
        { label: "极高密度", tier: "burst", limit: a.burst, info: "近 5 分钟至少 4 条消息" },
        { label: "高密度", tier: "high", limit: a.high, info: "近 5 分钟至少 2 条，或近 15 分钟至少 4 条消息" },
        { label: "日常", tier: "normal", limit: o.anchor, info: "使用 contextEntryLimit 作为日常档锚点" },
        { label: "低密度", tier: "low", limit: a.low, info: "近 30 分钟没有新消息" },
        { label: "自动推进", tier: "advance", limit: a.advance, info: "自动生活推进回合使用的档位" }
      ];
    }), w = F(() => {
      var a, m, i;
      const o = u.value === "fixed" ? (m = (a = r.overview) == null ? void 0 : a.density) == null ? void 0 : m.anchor : (i = f.value.find((b) => {
        var S, d;
        return b.tier === ((d = (S = r.overview) == null ? void 0 : S.density) == null ? void 0 : d.tier);
      })) == null ? void 0 : i.limit;
      return u.value === "auto" && o != null ? Math.max(4, Math.min(200, Math.floor(o))) : o;
    });
    return (o, a) => {
      const m = le("router-link");
      return t.overview ? (n(), s("div", Da, [
        a[5] || (a[5] = e("div", { class: "pg-head" }, [
          e("div", null, [
            e("h2", null, "上下文预算"),
            e("div", { class: "sub" }, "近期原始剧本的保留预算。密度统计按当前故事计算，私聊与群聊可分别设置模式和档位。")
          ])
        ], -1)),
        e("div", qa, [
          e("button", {
            class: Q({ on: l.value === "private" }),
            onClick: a[0] || (a[0] = (i) => l.value = "private")
          }, "私聊预算", 2),
          e("button", {
            class: Q({ on: l.value === "group" }),
            onClick: a[1] || (a[1] = (i) => l.value = "group")
          }, "群聊预算", 2),
          A(m, { to: "/hdsi/config-center" }, {
            default: re(() => [...a[2] || (a[2] = [
              O("在配置中心调整 →", -1)
            ])]),
            _: 1
          })
        ]),
        e("div", Ea, [
          e("div", Va, [
            a[3] || (a[3] = e("h3", null, [
              e("span", { class: "sq" }),
              O("当前档位")
            ], -1)),
            A(M, {
              label: "模式",
              value: u.value === "auto" ? "随密度自适应" : "固定预算",
              state: "acc",
              info: "fixed 使用锚点与时间窗；auto 按本页档位动态选择",
              range: "fixed | auto"
            }, null, 8, ["value"]),
            A(M, {
              label: "档位",
              value: `${u.value === "auto" ? k[t.overview.density.tier] ?? t.overview.density.tier : "固定"} → ${w.value ?? "—"} 条`,
              info: "当前密度对应的用户回合预算；fixed 可额外合并时间窗，auto 使用至少 4 条的档位硬上限。自动推进回合使用推进档。"
            }, null, 8, ["value"]),
            A(M, {
              label: "近 5 分钟",
              value: `${t.overview.density.counts.count5} 条消息`,
              info: "入站消息计数——密度信号源之一（burst 判定窗）"
            }, null, 8, ["value"]),
            A(M, {
              label: "近 15 分钟",
              value: `${t.overview.density.counts.count15} 条消息`,
              info: "入站消息计数——high 判定窗"
            }, null, 8, ["value"]),
            A(M, {
              label: "近 30 分钟",
              value: `${t.overview.density.counts.count30} 条消息`,
              info: "入站消息计数——low 判定窗（轨迹重载归零）"
            }, null, 8, ["value"])
          ]),
          e("div", La, [
            a[4] || (a[4] = e("h3", null, [
              e("span", { class: "sq" }),
              O("档位表")
            ], -1)),
            (n(!0), s(L, null, Z(f.value, (i) => (n(), z(M, {
              key: i.label,
              class: Q(["row", { on: u.value === "auto" && t.overview.density.tier === i.tier }]),
              label: i.label,
              value: i.limit == null ? "未提供配置" : `${i.limit} 条`,
              info: i.info
            }, null, 8, ["class", "label", "value", "info"]))), 128))
          ])
        ])
      ])) : p("", !0);
    };
  }
}), Ra = /* @__PURE__ */ X(Ta, [["__scopeId", "data-v-f55a4e87"]]), Ba = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Ra
}, Symbol.toStringTag, { value: "Module" }));
export {
  Fa as default
};
