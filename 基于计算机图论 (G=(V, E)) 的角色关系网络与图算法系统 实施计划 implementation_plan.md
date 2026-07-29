# 基于计算机图论 (G=(V, E)) 的角色关系网络与图算法系统 实施计划 (v5.0)

本方案正式确立：前端提供基于 CS 图结构的**物理力导向拓扑关系图**；后端基于 **NetworkX** 提供图算法；Prompt 规范 `description` 最长 100 字，`delta_summary` 聚焦身份、性格、阵营与关键关系的重点变化。

---

## 一、 系统整体架构 (v5.0 Architecture)

```
                            ┌─────────────────────────────────────────────────────────────┐
                            │                 LLM 校对萃取 (proofer.py)                   │
                            │  - description: 精炼全局概括 (上限 100 字)                  │
                            │  - delta_summary: 聚焦身份/性格/阵营/关系的重点变化 (15-30字) │
                            └──────────────────────────┬──────────────────────────────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            SQLite 后端解析与历史表落库 (database.py)                             │
│                                                                                                 │
│  - characters 表：最新 description (<=100字)                                                    │
│  - character_descriptions_history 表：(character_id, paragraph_idx, delta_summary)            │
│  - character_relationships 表：边 E (from, to, type, paragraph_idx)                              │
└──────────────────────────────┬──────────────────────────────────────────────────────────────────┘
                               │
                               ▼ (节点与边数据)
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           NetworkX 图引擎 (backend/app/core/graph_engine.py)                    │
│                                                                                                 │
│  1. 构建 Graph G=(V, E) 与时序切片图 G_t                                                        │
│  2. 图算法服务：                                                                                │
│     - 最短关系路径求解 (Dijkstra Shortest Path)                                                 │
│     - 介数中心度计算 (Betweenness Centrality -> 决定节点大小)                                   │
│     - 阵营/社区发现 (Louvain Community Detection -> 决定节点分组色彩)                            │
└──────────────────────────────┬──────────────────────────────────────────────────────────────────┘
                               │ REST API (/api/projects/{id}/character-graph)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                       前台真实 Graph 拓扑关系图视窗 (CharacterGraph.jsx)                          │
│                                                                                                 │
│ 1. 物理力导向 Layout 画布 (节点拖拽、自由缩放平移、中心度节点缩放、动态连线箭头与关系标签)       │
│ 2. 图算法交互：选择两角色一键高亮最短关系链、按阵营色彩区分节点                                  │
│ 3. 选中节点展开：展示 100 字 Profile + 按段落时序罗列的 delta_summary 重点变化履历链           │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、 详细设计与代码改动

### 1. System Prompt 约束微调 (`database.py`)

在 `DEFAULT_SYSTEM_PROMPT_PROOFREAD` 中明确说明：
```json
"character_updates": [
  {
    "name": "智星",
    "aliases": ["老大"],
    "role": "protagonist",
    "first_appear_idx": 0,
    "description": "沿河村少年，聪明机敏，三人中排行老大。后在天山拜剑圣为师，现为蜀山记名弟子，性格沉稳兼具果敢。",
    "delta_summary": "在本段中揭示其拥有蜀山记名弟子身份，并展现出御剑术突破"
  }
]
```
* **`description`（精炼全局概括）**：上限 **100 字**。记录角色的核心身份、性格与最新全局定位。当本段发生重大转折时进行精炼微调，严禁写成流水账。
* **`delta_summary`（重点变化总结）**：关注**身份演变、性格转折、阵营立场转变或重大关系契机**等核心重点变化（15 ~ 30 字），拒绝无意义琐碎细节。

---

### 2. 后端图算法引擎与依赖 (`graph_engine.py` & `requirements.txt`)

#### [MODIFY] [requirements.txt](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/backend/requirements.txt)
* 添加 `networkx>=3.0`。

#### [NEW] [graph_engine.py](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/backend/app/core/graph_engine.py)
* **`build_nx_graph(project_id, upto_para_idx)`**：构建 NetworkX `DiGraph`。
* **`get_graph_topology(project_id, upto_para_idx)`**：
  * 计算节点的 **Betweenness Centrality（介数中心度）**，作为节点在前端 Canvas 中的渲染半径依据（核心人物节点变大）。
  * 运行 **Louvain/Components 社区发现**，输出节点的 `community_id`（用于前端阵营色彩分组）。
  * 挂载按 `paragraph_idx` 排序的 `delta_summary` 履历列表。
* **`find_shortest_path(project_id, source, target)`**：计算两角色的最短路径节点序列与沿线关系描述。

#### [NEW TABLE] `character_descriptions_history` (`database.py`)
```sql
CREATE TABLE IF NOT EXISTS character_descriptions_history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    paragraph_idx INTEGER NOT NULL DEFAULT 0,
    delta_summary TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (character_id) REFERENCES characters(id)
);
```

---

### 3. 前台真实 Graph 拓扑关系网络图组件 (`CharacterGraph.jsx`)

#### [MODIFY] [CharacterGraph.jsx](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/frontend/src/components/CharacterGraph.jsx)
1. **真实物理力导向 Graph 画布**：
   * 基于 HTML5 Canvas / SVG 绘制节点与带方向箭头的连线。
   * 支持鼠标滚轮缩放、画布平移、拖拽节点自适应重绘。
   * 节点半径根据 NetworkX 返回的 `centrality` 动态缩放；节点颜色根据 `community_id` 阵营自动打色。
2. **图算法交互工具栏**：
   * 下拉选择角色 $A$ 与 $B$，实时在 Canvas 图上高亮两者的 **最短关系演进路径**。
   * 拖动剧情推进 Slider，实时展现随段落推进的图拓扑演化快照 $G_t$。
3. **节点详情侧边栏**：
   * 点击节点展开：展示最多 **100 字的精炼 Profile (`description`)**，以及按段落排列的 **重点变化演进履历链 (`delta_summary`)**。

---

## 三、 验证计划 (Verification Plan)

### 1. 自动化测试
* **Python 依赖与语法检查**：
  * `pip install networkx`
  * `python3 -m py_compile backend/app/core/graph_engine.py`
  * 执行 `pytest` / 编写 `test_graph_engine.py` 验证拓扑路径计算与中心度数值。
* **前端编译打包**：
  * 执行 `npm run build` 确保 Vite 0 错误通过。

### 2. 手动验证
* 在前台打开“人物关系图谱”，验证 Canvas 画布力导向节点布局与缩放拖拽体验。
* 测试关系路径求解，验证任意两角色间的高亮关系链。
* 检查节点详情侧边栏的 100 字 Profile 与 `delta_summary` 重点变化履历链。
