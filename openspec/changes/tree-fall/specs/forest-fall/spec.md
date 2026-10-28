# forest-fall 规格差量

## ADDED Requirements

### Requirement: 定向倒地取代沉没动画
被砍倒的树 SHALL 以**树根为轴心倾覆**（旋转至接近 90° 躺倒，尾段微缩放收出画面），MUST NOT 再以"原地均匀缩小下沉"消失。倒地时长按树种（`TREES.fallDur`）：松 0.55s、橡 0.75s、桦 0.42s——重量感来自倒速差异。倾倒方向 MUST 优先背离伐木者（结算时写入的 `fallYaw`），无来源时 MAY 随机。倒地 MUST 仅为表现层：树桩空窗、生长阶段机、拾取终态（地下）、计数口径 MUST 与现状一致。

#### Scenario: 树倒向背离砍它的人
- **WHEN** 角色从树的东侧砍倒一棵松树
- **THEN** 消亡样本的 fallYaw 使树冠向西倾倒（与伐木者方位相反，容差 ±0.6 rad）

#### Scenario: 橡树比白桦倒得沉
- **WHEN** 分别砍倒橡树与白桦
- **THEN** 两者的消亡时长分别为 0.75s 与 0.42s（夹具可读），白桦先完成出画

#### Scenario: 空窗与生长语义不变
- **WHEN** 一棵树完成倒地动画
- **THEN** 该树从 targets 计数消失（alive=false、拾取失效），15s 后仍按阶段机冒苗

### Requirement: 砸地镜头微震与落地重音
倒地终态时刻 SHALL 触发镜头微震（幅度按树种重量分档、0.18s 内衰减归零，由每帧重设的相机自然自愈，MUST NOT 干扰相机跟随/缩放状态）与一次砸地重音（sfx `down`）；起倒时刻的倒木沙沙（sfx `thud`）SHALL 保留。

#### Scenario: 砍橡树砸地一震
- **WHEN** 砍倒橡树且倒地结束
- **THEN** fallInfo 显示震幅>0 随后归零，声音 counts 中 down 与 thud 各恰好新增 1

#### Scenario: 震动不破坏镜头断言
- **WHEN** 倒地瞬间同页继续下达右键命令
- **THEN** 相机目标与投影行为无残留偏移（震停即恢复）
