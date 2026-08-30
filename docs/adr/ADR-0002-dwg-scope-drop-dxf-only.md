# ADR-0002: DWG対応を方針から撤回し、DXF単体運用へ確定

## ステータス

承認済み(Accepted、2026-08-30) — ユーザーがAskUserQuestionで「確定する(推奨)」を選択し決定

## コンテキスト

[ADR-0001](ADR-0001-dwg-dxf-roundtrip-engine.md)は、DWG/DXF round-trip engineの選定において、ハイブリッド案(DXF正本+ODA File Converter CLIブリッジ、短期)とODA Drawings SDK正式契約(中期候補)を推奨した。しかし、いずれの案も実装着手の前提条件としてODA File Converterの商用利用許諾取得(ODA会員契約または明示的な許諾)を必要とし、2026-08-30時点でこの契約手続きは未着手のまま数ヶ月間停滞していた。

この状況を踏まえ、ユーザーからODAライセンス依存を回避する代替案2点の検討を依頼された。

1. DXF仕様を基に自作パーサー／ジェネレーターを実装する
2. ezdxf等のオープンソースライブラリを利用する

### 調査結果

**DXF単体なら両案とも技術的に実現可能である。**

- DXF仕様(DXF Reference)はAutodeskが公式PDFで公開しており、当プロジェクトが必要とする基本entity(LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE/TEXT/MTEXT/DIMENSION/HATCH/INSERT等)は十分に文書化されている。既存実装(`src/importers.js`)は既に`dxf-parser`(npm)によるDXF ASCII Importという土台を持つ
- Node.js/TypeScript製のオープンソースDXFライブラリとして`@tarikjabiri/dxf`(dxf-writer、MIT License)が存在し、DXF書出し(ジェネレーター)を自作せず採用する選択肢もある。ADR-0001作成時点ではこのライブラリは調査対象に含まれていなかった

**DWGはどちらの案でも解決しない。**

- Pythonの著名なDXF/DWGライブラリ`ezdxf`のDWG対応は、公式ドキュメント上「odafc」という別パッケージ(add-on)経由のみで提供されており、その実体はODA File Converter CLIをサブプロセスとして呼び出しているだけである。つまりezdxfを採用しても、ADR-0001で検討済みかつライセンス未取得のまま停滞している同じODA File Converterへの依存は解消されない
- 自作DWGパーサー/ジェネレーターについては、オープンソースの先行実装であるLibreDWG(GPLv3)が2003年のプロジェクト開始から20年以上を経てなお、DWG**読込**は約99%(r1.2〜2018対応)である一方、DWG**書込**はR2004以降が実験的、R2007は直接非対応(R2010へフォールバック)という状態にとどまっている(ADR-0001の調査時点、LibreDWG 0.13.4)。この実例は、DWGバイナリ形式の大部分がAutodesk非公開である以上、自社の限られた開発リソースで実務水準のDWG往復を独自実装することが現実的でないことを裏付けている

### 業務要件への影響

[80-90%代替方針](../Mirai-Web-CAD_80-90％代替・AI統合開発方針.md)は当初、「既存DWGを開いて修正しDWGで返却」する業務を代替率5〜10%の独立した業務シナリオとして明記し、DWG／DXF往復を80%必須範囲の第1項目に位置付けていた。したがって本決定は、実装上の技術選択にとどまらず、**同方針文書が定めた業務要件を撤回する経営判断**である。この点をユーザーへ明示的に確認し、AskUserQuestionで「DWG対応を正式に方針から削除し、DXF単体のみをサポート対象とすることで確定してよろしいですか？(取引先の納品要件としてDWGが指定される契約が現時点でないことを前提とします)」という問いに対し、「確定する(推奨)」の回答を得た。

## 決定

**DWGバイナリ形式への対応を恒久的に対象外とし、DXF(ASCII)のみをサポート対象とする。**

- ODA File Converter/ODA Drawings SDKの商用ライセンス契約に関する意思決定は不要になる
- DXF書出しの実装手段(自作パーサー/ジェネレーター、または`@tarikjabiri/dxf`等のOSSライブラリの採用)は本ADRでは決定せず、別タスク([改善台帳](../improvement-register.md)P1-03)で検討する
- 「DWGを受領し修正後にDWGで返却する」業務シナリオは方針文書から削除し、「DXFを受領し修正後にDXFで返却する」業務へ統一する

## 影響

- [80-90%代替方針](../Mirai-Web-CAD_80-90％代替・AI統合開発方針.md)からDWG関連記述(業務定義、80%必須範囲、代替率内訳表、Phase 0/1タスク、完了基準)を削除しDXFへ統一(本ADRと同日、同一PRで実施)
- [ADR-0001](ADR-0001-dwg-dxf-roundtrip-engine.md)のステータスを「破棄(Superseded by ADR-0002)」へ変更。本文は検討記録として保持
- [代替範囲・採点基準](../compat-scope-and-scoring.md)の恒久的対象外リストへ「DWGバイナリ形式(ADR-0002)」を追加
- [100図面台帳](../compat-corpus/README.md)のスキーマから`file.originalDwgVersion`フィールドを削除(Phase 0時点で台帳は0件のため、データ移行は不要)
- 改善台帳P1-03「DWG/DXF round-trip engine選定」を「DXF書出し実装」へリタイトルし、依存「SDK契約・license」を削除、工数見積りを縮小
- GitHub Issue #6「DWG往復と2D CAD中核機能を実案件で認定する」を「DXF往復と2D CAD中核機能を実案件で認定する」へリタイトル。継続する作業(DXF往復の実案件認定)自体はcloseしない
- 代替率の数値(現状評価30〜35%、内訳表の各値、目標55〜70%等)は本ADRでは再計算しない。方針文書の名称置換にとどめ、数値の再評価は次回監査サイクルで実施する

## 残存リスク

納品形式としてDWGを指定する契約が将来発生した場合の扱いは未定である。その時点で改めてDWG対応の要否を評価し、必要であれば新規ADRを起票して本決定を見直す(ADR-0001の検討記録は破棄扱いのまま保持しているため、再評価の出発点として再利用できる)。この判断自体は人間(経営・営業)側の契約状況に依存するため、本ADRの範囲外とする。

## 参考情報源

- Autodesk DXF Reference(公式仕様、公開PDF): https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-235B22E0-A567-4CF6-92D3-38A2306D73F3
- ezdxf odafc add-on(DWG対応がODA File Converterへの委譲であることの公式説明): https://ezdxf.readthedocs.io/en/stable/addons/odafc.html
- `@tarikjabiri/dxf`(dxf-writer、MIT License、npm): https://www.npmjs.com/package/@tarikjabiri/dxf
- LibreDWG Manual(v0.13.4、DWG読込・書込の対応状況): https://www.gnu.org/software/libredwg/manual/LibreDWG.html
- [ADR-0001](ADR-0001-dwg-dxf-roundtrip-engine.md)(本ADRが破棄した先行ADR、参考情報源を含む)
