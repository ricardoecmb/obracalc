"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Lock,
  FileEdit,
  Trash2,
  Plus,
  RefreshCw,
  Copy,
  ChevronRight,
  ChevronDown,
  Search,
  CheckCircle2,
  X,
  Layers,
  Check,
  AlertTriangle,
  Loader2,
  FileSpreadsheet,
  ShieldCheck,
  Edit2,
  Hash,
  Save,
  FolderOpen,
  PanelRight,
  Keyboard,
  Wrench,
  ClipboardCheck,
  Upload,
} from "lucide-react";
import {
  createStage,
  updateStage,
  deleteStage,
  addBudgetItem,
  updateBudgetItem,
  deleteBudgetItem,
  deleteBudgetItems,
  recalculateBudgetRevision,
  finalizeRevision,
  createNewRevision,
  searchCompositions,
  renumberStages,
  saveBudgetTemplate,
  applyBudgetTemplate,
} from "@/lib/actions/budgets";
import {
  createCompositionInBudgetAction,
  type CompositionFormData,
} from "@/lib/actions/compositions";
import { searchResources } from "@/lib/actions/resources";
import { createRevisionFromFinalizedAction } from "@/lib/actions/revision-compare";
import { RevisionAuditModal } from "./revision-audit-modal";
import { BudgetImportModal } from "./budget-import-modal";
import { DatabaseSource, TaxRegime, CompositionType } from "@prisma/client";

// ============================================================================
// TIPOS DA PROPRIEDADE DO EDITOR
// ============================================================================

export interface BudgetItemDto {
  id: string;
  stageId: string;
  compositionId: string;
  sortOrder: number;
  quantity: string;
  bdiOverrideId: string | null;
  unitCostMaterial: string;
  unitCostLabor: string;
  unitCostEquipment: string;
  unitCostOther: string;
  unitCostTotal: string;
  subtotal: string;
  bdiRate: string;
  subtotalWithBdi: string;
  notes: string | null;
  composition: {
    id: string;
    code: string;
    description: string;
    unit: string;
    source: string;
    type: string;
  };
  bdiOverride?: {
    id: string;
    name: string;
    bdiRate: string;
  } | null;
}

export interface StageDto {
  id: string;
  parentStageId: string | null;
  code: string;
  title: string;
  description: string | null;
  sortOrder: number;
  items: BudgetItemDto[];
  childStages?: StageDto[];
}

export interface StageNode extends StageDto {
  childStages: StageNode[];
  calculatedDirect: number;
  calculatedWithBdi: number;
}

export interface RevisionDto {
  id: string;
  revisionNumber: number;
  status: "DRAFT" | "FINALIZED";
  referenceState: string | null;
  referenceMonth: string | null;
  referenceTaxRegime: string | null;
  technicalResponsible: string | null;
  baseDate: string | null;
  roundingPriceDecimals: number;
  roundingQuantityDecimals: number;
  roundingCoefficientDecimals: number;
  roundingTotalDecimals: number;
  roundingMode: string;
  bdiConfig: {
    id: string;
    name: string;
    bdiRate: string;
  } | null;
  snapshot: {
    checksum: string;
    createdAt: string;
  } | null;
  stages: StageDto[];
}

export interface BudgetTemplateOption {
  id: string;
  name: string;
  description: string | null;
  stageCount: number;
  itemCount: number;
}

export interface BudgetEditorProps {
  budgetId: string;
  budgetTitle: string;
  budgetDescription: string | null;
  project: {
    id: string;
    name: string;
    state: string | null;
    client: { name: string } | null;
  };
  revisions: RevisionDto[];
  bdiConfigs: Array<{ id: string; name: string; bdiRate: string }>;
  templates?: BudgetTemplateOption[];
}

interface CompositionSearchResult {
  id: string;
  code: string;
  description: string;
  unit: string;
  source: string;
  type: string;
  closedTotalPrice: string | null;
  unitCostTotal: string | null;
}

interface ResourceSearchResult {
  id: string;
  code: string;
  description: string;
  unit: string;
  price: string;
}

export function BudgetEditor({
  budgetId,
  budgetTitle,
  budgetDescription,
  project,
  revisions,
  bdiConfigs,
  templates = [],
}: BudgetEditorProps) {
  const router = useRouter();

  // Revisão Ativa
  const [activeRevisionId, setActiveRevisionId] = useState<string>(
    revisions[0]?.id || ""
  );

  const activeRevision = useMemo(() => {
    return revisions.find((r) => r.id === activeRevisionId) || revisions[0];
  }, [revisions, activeRevisionId]);

  const isFinalized = activeRevision?.status === "FINALIZED";

  // Estados de Carregamento e Notificações
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Estados dos Modais
  const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);
  const [targetStageIdForAdd, setTargetStageIdForAdd] = useState<string>("");
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<StageDto | null>(null);
  const [parentStageForNew, setParentStageForNew] = useState<string | null>(null);
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [copiedSha, setCopiedSha] = useState(false);

  // Estado para busca de composições no Drawer
  const [searchQuery, setSearchQuery] = useState("");
  const [searchingComps, setSearchingComps] = useState(false);
  const [compResults, setCompResults] = useState<CompositionSearchResult[]>([]);
  const [selectedComp, setSelectedComp] = useState<CompositionSearchResult | null>(null);
  const [itemQuantity, setItemQuantity] = useState("1.0000");
  const [itemBdiOverrideId, setItemBdiOverrideId] = useState<string>("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Estado para edição rápida de quantidade de item
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [tempQuantity, setTempQuantity] = useState("");
  const quantityRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Estado de colapso de etapas
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>({});

  // Seleção múltipla e painel lateral
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectionPanelOpen, setSelectionPanelOpen] = useState(false);

  // Modelos de EAP
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [applyTemplateModalOpen, setApplyTemplateModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  // Cadastro de composição própria dentro do orçamento
  const [createCompOpen, setCreateCompOpen] = useState(false);
  const [newCompCode, setNewCompCode] = useState("");
  const [newCompDescription, setNewCompDescription] = useState("");
  const [newCompUnit, setNewCompUnit] = useState("un");
  const [newCompType, setNewCompType] = useState<CompositionType>(CompositionType.CLOSED);
  const [newCompClosedPrice, setNewCompClosedPrice] = useState("");
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourceResults, setResourceResults] = useState<ResourceSearchResult[]>([]);
  const [selectedResource, setSelectedResource] = useState<ResourceSearchResult | null>(null);
  const [resourceCoefficient, setResourceCoefficient] = useState("1.00000");

  const toggleStageCollapse = (stageId: string) => {
    setCollapsedStages((prev) => ({ ...prev, [stageId]: !prev[stageId] }));
  };

  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
    setSelectionPanelOpen(true);
  };

  const clearSelection = () => {
    setSelectedItemIds([]);
    setSelectionPanelOpen(false);
  };

  // Notificação temporária
  const showNotice = (type: "success" | "error", text: string) => {
    setActionMessage({ type, text });
    setTimeout(() => setActionMessage(null), 5000);
  };

  // ============================================================================
  // CÁLCULO ESTRUTURADO DA EAP COM RECONCILIAÇÃO DETERMINÍSTICA
  // ============================================================================

  // Monta a árvore hierárquica de etapas e calcula os subtotais de cada nó
  const { rootStagesList, budgetTotals, flatStagesList } = useMemo(() => {
    if (!activeRevision) {
      return {
        rootStagesList: [],
        budgetTotals: { direct: 0, withBdi: 0, bdiAmount: 0, effectiveBdi: 0, itemsCount: 0 },
        flatStagesList: [],
      };
    }

    const stageMap = new Map<string, StageNode>();
    const roots: StageNode[] = [];
    const flat: Array<{ id: string; code: string; title: string }> = [];

    // 1. Inicializar todas as etapas no mapa
    activeRevision.stages.forEach((st) => {
      const node: StageNode = {
        ...st,
        childStages: [],
        calculatedDirect: 0,
        calculatedWithBdi: 0,
      };
      stageMap.set(st.id, node);
      flat.push({ id: st.id, code: st.code, title: st.title });
    });

    // 2. Montar árvore pai -> filhos
    activeRevision.stages.forEach((st) => {
      const node = stageMap.get(st.id)!;
      if (st.parentStageId && stageMap.has(st.parentStageId)) {
        const parent = stageMap.get(st.parentStageId)!;
        parent.childStages = parent.childStages || [];
        parent.childStages.push(node);
      } else {
        roots.push(node);
      }
    });

    // Ordenar nós por sortOrder
    const sortNodes = (list: StageNode[]) => {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
      list.forEach((n) => {
        if (n.childStages && n.childStages.length > 0) {
          sortNodes(n.childStages);
        }
      });
    };
    sortNodes(roots);

    // 3. Função recursiva de agregação financeira
    let totalItems = 0;
    const calculateTotals = (node: StageNode): { direct: number; withBdi: number } => {
      let directSum = 0;
      let withBdiSum = 0;

      // Itens diretos da etapa
      (node.items || []).forEach((it: BudgetItemDto) => {
        directSum += Number(it.subtotal || 0);
        withBdiSum += Number(it.subtotalWithBdi || 0);
        totalItems++;
      });

      // Subetapas
      (node.childStages || []).forEach((child) => {
        const childTot = calculateTotals(child);
        directSum += childTot.direct;
        withBdiSum += childTot.withBdi;
      });

      node.calculatedDirect = directSum;
      node.calculatedWithBdi = withBdiSum;

      return { direct: directSum, withBdi: withBdiSum };
    };

    let totalDirect = 0;
    let totalWithBdi = 0;

    roots.forEach((root) => {
      const tot = calculateTotals(root);
      totalDirect += tot.direct;
      totalWithBdi += tot.withBdi;
    });

    const bdiAmount = totalWithBdi - totalDirect;
    const effectiveBdi = totalDirect > 0 ? (bdiAmount / totalDirect) * 100 : 0;

    return {
      rootStagesList: roots,
      flatStagesList: flat,
      budgetTotals: {
        direct: totalDirect,
        withBdi: totalWithBdi,
        bdiAmount,
        effectiveBdi,
        itemsCount: totalItems,
      },
    };
  }, [activeRevision]);

  const allItemIds = useMemo(
    () => activeRevision?.stages.flatMap((stage) => stage.items.map((item) => item.id)) ?? [],
    [activeRevision]
  );

  const selectedItems = useMemo(() => {
    if (!activeRevision) return [];
    return activeRevision.stages
      .flatMap((stage) => stage.items)
      .filter((item) => selectedItemIds.includes(item.id));
  }, [activeRevision, selectedItemIds]);

  const selectedTotals = useMemo(() => {
    return selectedItems.reduce(
      (acc, item) => {
        acc.direct += Number(item.subtotal || 0);
        acc.withBdi += Number(item.subtotalWithBdi || 0);
        return acc;
      },
      { direct: 0, withBdi: 0 }
    );
  }, [selectedItems]);

  // ============================================================================
  // HANDLERS DE AÇÕES
  // ============================================================================

  // 1. Recalcular Revisão Geral
  const handleRecalculate = async () => {
    setLoading(true);
    const res = await recalculateBudgetRevision(activeRevision.id);
    setLoading(false);

    if (res.success) {
      showNotice("success", `Orçamento recalculado com sucesso (${res.updatedCount} itens sincronizados).`);
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao recalcular orçamento.");
    }
  };

  // 2. Finalizar Revisão com Snapshot Imutável
  const handleFinalize = async () => {
    setLoading(true);
    const res = await finalizeRevision(activeRevision.id);
    setLoading(false);
    setFinalizeModalOpen(false);

    if (res.success) {
      showNotice("success", "Revisão finalizada e protegida por snapshot criptográfico SHA-256!");
      router.refresh();
    } else {
      if ((res as { blocked?: boolean }).blocked) {
        setAuditModalOpen(true);
      }
      showNotice("error", res.error || "Erro ao finalizar revisão.");
    }
  };

  // 3. Criar Nova Revisão
  const handleCreateNewRevision = async () => {
    const isSourceFinalized = activeRevision?.status === "FINALIZED";
    const message = isSourceFinalized
      ? "Criar uma nova revisão editável a partir desta revisão finalizada? O snapshot original será preservado."
      : "Deseja criar uma nova revisão editável (Rascunho) a partir desta?";

    if (!window.confirm(message)) {
      return;
    }

    setLoading(true);
    const res = isSourceFinalized
      ? await createRevisionFromFinalizedAction({ revisionId: activeRevision.id })
      : await createNewRevision(budgetId);
    setLoading(false);

    if (res.success) {
      showNotice(
        "success",
        `Revisão ${res.revisionNumber} criada com sucesso${isSourceFinalized ? " (snapshot verificado)" : ""}.`
      );
      if (res.revisionId) setActiveRevisionId(res.revisionId);
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao criar nova revisão.");
    }
  };

  // 4. Salvar Edição Rápida de Quantidade
  const handleSaveQuantity = async (itemId: string) => {
    if (!tempQuantity || isNaN(Number(tempQuantity))) {
      showNotice("error", "Informe uma quantidade numérica válida.");
      return;
    }

    setLoading(true);
    const res = await updateBudgetItem({
      itemId,
      quantity: tempQuantity,
    });
    setLoading(false);
    setEditingItemId(null);

    if (res.success) {
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao atualizar quantidade.");
    }
  };

  // 5. Excluir Item
  const handleDeleteItem = async (itemId: string, desc: string) => {
    if (!window.confirm(`Deseja remover o item "${desc}" da planilha?`)) return;

    setLoading(true);
    const res = await deleteBudgetItem(itemId);
    setLoading(false);

    if (res.success) {
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao remover item.");
    }
  };

  // 6. Excluir Etapa
  const handleDeleteStage = async (stageId: string, title: string) => {
    if (!window.confirm(`Deseja excluir a etapa "${title}" e todos os seus itens e subetapas?`)) return;

    setLoading(true);
    const res = await deleteStage(stageId);
    setLoading(false);

    if (res.success) {
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao excluir etapa.");
    }
  };

  // 7. Busca de Composições no Drawer
  const handleSearchCompositions = async (q: string) => {
    setSearchQuery(q);
    if (!q || q.length < 2) {
      setCompResults([]);
      return;
    }

    setSearchingComps(true);
    const res = await searchCompositions({ query: q, limit: 15 });
    setSearchingComps(false);

    if (res.success) {
      setCompResults(res.compositions);
    }
  };

  // 8. Adicionar Composição Selecionada à Planilha
  const handleAddCompToBudget = async () => {
    if (!selectedComp || !targetStageIdForAdd) return;

    setLoading(true);
    const res = await addBudgetItem({
      stageId: targetStageIdForAdd,
      compositionId: selectedComp.id,
      quantity: itemQuantity || "1.0000",
      bdiOverrideId: itemBdiOverrideId || null,
    });
    setLoading(false);

    if (res.success) {
      showNotice("success", `Item ${selectedComp.code} adicionado com sucesso à etapa.`);
      setSelectedComp(null);
      setItemQuantity("1.0000");
      setSearchDrawerOpen(false);
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao adicionar item.");
    }
  };

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val);
  };

  // 9. Excluir itens selecionados em lote
  const handleDeleteSelected = async () => {
    if (selectedItemIds.length === 0) return;

    if (
      !window.confirm(
        `Deseja remover ${selectedItemIds.length} item(ns) selecionado(s) da planilha?`
      )
    ) {
      return;
    }

    setLoading(true);
    const res = await deleteBudgetItems(selectedItemIds);
    setLoading(false);

    if (res.success) {
      showNotice("success", `${res.deletedCount ?? selectedItemIds.length} item(ns) removido(s).`);
      clearSelection();
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao remover itens selecionados.");
    }
  };

  // 10. Renumerar toda a EAP
  const handleRenumberStages = async () => {
    if (!window.confirm("Renumerar automaticamente todas as etapas (1, 1.1, 2, ...)?")) {
      return;
    }

    setLoading(true);
    const res = await renumberStages(activeRevision.id);
    setLoading(false);

    if (res.success) {
      showNotice("success", `EAP renumerada (${res.updatedCount} etapas).`);
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao renumerar a EAP.");
    }
  };

  // 11. Salvar revisão atual como modelo de EAP
  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      showNotice("error", "Informe um nome para o modelo.");
      return;
    }

    setLoading(true);
    const res = await saveBudgetTemplate({
      revisionId: activeRevision.id,
      name: templateName,
      description: templateDescription || null,
    });
    setLoading(false);

    if (res.success) {
      showNotice("success", "Modelo de EAP salvo com sucesso.");
      setTemplateModalOpen(false);
      setTemplateName("");
      setTemplateDescription("");
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao salvar modelo.");
    }
  };

  // 12. Aplicar modelo de EAP à revisão ativa
  const handleApplyTemplate = async () => {
    if (!selectedTemplateId) {
      showNotice("error", "Selecione um modelo.");
      return;
    }

    setLoading(true);
    const res = await applyBudgetTemplate({
      revisionId: activeRevision.id,
      templateId: selectedTemplateId,
    });
    setLoading(false);

    if (res.success) {
      showNotice("success", "Modelo aplicado à revisão atual.");
      setApplyTemplateModalOpen(false);
      setSelectedTemplateId("");
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao aplicar modelo.");
    }
  };

  // 13. Busca aproximada de insumos para composição criada no orçamento
  const handleSearchResources = async (query: string) => {
    setResourceQuery(query);
    if (query.trim().length < 2) {
      setResourceResults([]);
      return;
    }

    const res = await searchResources({ query, limit: 8 });
    if (res.success) {
      setResourceResults(res.resources as ResourceSearchResult[]);
    }
  };

  // 14. Criar composição própria e incluí-la imediatamente na planilha
  const handleCreateCompositionInBudget = async () => {
    if (!targetStageIdForAdd) {
      showNotice("error", "Selecione a etapa de destino.");
      return;
    }
    if (!newCompCode.trim() || !newCompDescription.trim() || !newCompUnit.trim()) {
      showNotice("error", "Preencha código, descrição e unidade da composição.");
      return;
    }

    const isClosed = newCompType === CompositionType.CLOSED;

    if (isClosed && (!newCompClosedPrice || Number(newCompClosedPrice) < 0)) {
      showNotice("error", "Informe o preço total fechado da composição.");
      return;
    }
    if (!isClosed && !selectedResource) {
      showNotice("error", "Selecione ao menos um insumo para a composição analítica.");
      return;
    }

    const composition: CompositionFormData = {
      code: newCompCode.trim(),
      description: newCompDescription.trim(),
      unit: newCompUnit.trim(),
      source: DatabaseSource.CUSTOM,
      sourceState: "SP",
      sourceMonth: "2024/01",
      sourceTaxRegime: TaxRegime.DESONERADO,
      type: newCompType,
      closedTotalPrice: isClosed ? Number(newCompClosedPrice) : null,
      closedMaterialPrice: null,
      closedLaborPrice: null,
      closedEquipmentPrice: null,
      closedOtherPrice: null,
      notes: "Criada dentro do orçamento",
    };

    const components =
      !isClosed && selectedResource
        ? [
            {
              compositionId: "pending",
              resourceId: selectedResource.id,
              childCompositionId: null,
              coefficient: resourceCoefficient,
              notes: null,
            },
          ]
        : [];

    setLoading(true);
    const res = await createCompositionInBudgetAction({
      stageId: targetStageIdForAdd,
      composition,
      components,
      quantity: itemQuantity || "1.0000",
      bdiOverrideId: itemBdiOverrideId || null,
    });
    setLoading(false);

    if (res.success) {
      showNotice("success", `Composição ${newCompCode} criada e incluída na planilha.`);
      setCreateCompOpen(false);
      setNewCompCode("");
      setNewCompDescription("");
      setNewCompClosedPrice("");
      setSelectedResource(null);
      setResourceQuery("");
      setResourceResults([]);
      setSelectedComp(null);
      setSearchDrawerOpen(false);
      router.refresh();
    } else {
      showNotice("error", res.error || "Erro ao criar composição no orçamento.");
    }
  };

  // Navegação por teclado entre células de quantidade
  const handleQuantityKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    itemId: string
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const nodes = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-quantity-item]")
      );
      const index = nodes.indexOf(event.currentTarget);
      const next = nodes[index + (event.key === "ArrowDown" ? 1 : -1)];
      next?.focus();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setEditingItemId(itemId);
      setTempQuantity(itemId ? String(activeRevision?.stages.flatMap((s) => s.items).find((i) => i.id === itemId)?.quantity ?? "") : "");
    }
  };

  // Atalhos globais: "/" busca, Ctrl+Enter recalcula, Delete remove seleção.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable);

      if (event.key === "Escape") {
        setSearchDrawerOpen(false);
        setStageModalOpen(false);
        setFinalizeModalOpen(false);
        setTemplateModalOpen(false);
        setApplyTemplateModalOpen(false);
        setCreateCompOpen(false);
        setSelectionPanelOpen(false);
        return;
      }

      if (isTyping) return;

      if (event.key === "/") {
        event.preventDefault();
        if (!isFinalized && flatStagesList.length > 0) {
          setTargetStageIdForAdd(
            targetStageIdForAdd || flatStagesList[0]?.id || ""
          );
          setSearchDrawerOpen(true);
          setTimeout(() => searchInputRef.current?.focus(), 50);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (!isFinalized && !loading) void handleRecalculate();
        return;
      }

      if (event.key === "Delete" && selectedItemIds.length > 0 && !isFinalized) {
        event.preventDefault();
        void handleDeleteSelected();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemIds, isFinalized, loading, flatStagesList, targetStageIdForAdd]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSha(true);
    setTimeout(() => setCopiedSha(false), 2000);
  };

  // ============================================================================
  // RENDERIZAÇÃO DA TABELA HIERÁRQUICA EAP
  // ============================================================================

  const renderStage = (stage: StageNode, depth = 0) => {
    const isCollapsed = !!collapsedStages[stage.id];
    const hasChildren = (stage.childStages && stage.childStages.length > 0) || (stage.items && stage.items.length > 0);
    const weightPercent = budgetTotals.withBdi > 0 ? (stage.calculatedWithBdi / budgetTotals.withBdi) * 100 : 0;

    return (
      <div
        key={stage.id}
        id={`stage-${stage.id}`}
        data-stage-id={stage.id}
        className="border-b border-slate-100 last:border-b-0"
      >
        {/* Linha da Etapa */}
        <div
          className={`flex items-center justify-between px-4 py-3 transition-colors ${
            depth === 0
              ? "bg-slate-100/90 font-bold text-slate-900 border-t border-slate-200"
              : depth === 1
              ? "bg-slate-50/70 font-semibold text-slate-800"
              : "bg-white font-medium text-slate-700"
          }`}
          style={{ paddingLeft: `${Math.max(16, 16 + depth * 24)}px` }}
        >
          {/* Identificação da Etapa */}
          <div className="flex items-center gap-2 min-w-0">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleStageCollapse(stage.id)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition-colors"
              >
                {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            ) : (
              <div className="w-6" />
            )}

            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-700">
              {stage.code}
            </span>

            <span className="truncate text-xs sm:text-sm">
              {stage.title}
            </span>
          </div>

          {/* Totais da Etapa e Ações */}
          <div className="flex items-center gap-4 text-xs font-mono">
            {/* Peso Relativo na Obra */}
            <span className="hidden md:inline-block text-slate-400 text-[11px] w-14 text-right">
              {weightPercent.toFixed(1)}%
            </span>

            {/* Total Direto */}
            <span className="hidden sm:inline-block text-slate-600 w-28 text-right font-medium">
              {formatBRL(stage.calculatedDirect)}
            </span>

            {/* Total com BDI */}
            <span className="text-slate-900 w-32 text-right font-bold">
              {formatBRL(stage.calculatedWithBdi)}
            </span>

            {/* Botões de Ação da Etapa */}
            {!isFinalized && (
              <div className="flex items-center gap-1 font-sans">
                <button
                  type="button"
                  title="Adicionar Item de Serviço a esta etapa"
                  onClick={() => {
                    setTargetStageIdForAdd(stage.id);
                    setSearchDrawerOpen(true);
                  }}
                  className="p-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors text-xs flex items-center gap-1 font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline text-[11px]">Item</span>
                </button>

                <button
                  type="button"
                  title="Adicionar Subetapa"
                  onClick={() => {
                    setParentStageForNew(stage.id);
                    setEditingStage(null);
                    setStageModalOpen(true);
                  }}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors"
                >
                  <Layers className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  title="Editar Etapa"
                  onClick={() => {
                    setEditingStage(stage);
                    setParentStageForNew(null);
                    setStageModalOpen(true);
                  }}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  title="Excluir Etapa"
                  onClick={() => handleDeleteStage(stage.id, stage.title)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Itens e Subetapas da Etapa (se não colapsado) */}
        {!isCollapsed && (
          <div>
            {/* Itens da Etapa */}
            {stage.items && stage.items.length > 0 && (
              <div className="divide-y divide-slate-100">
                {stage.items.map((item: BudgetItemDto) => {
                  const isEditingQty = editingItemId === item.id;
                  const itemDirect = Number(item.subtotal || 0);
                  const itemWithBdi = Number(item.subtotalWithBdi || 0);
                  const isBdiOverridden = !!item.bdiOverrideId;

                  return (
                    <div
                      key={item.id}
                      id={`item-${item.id}`}
                      data-item-id={item.id}
                      className="flex items-center justify-between px-4 py-2.5 text-xs hover:bg-blue-50/20 transition-colors group"
                      style={{ paddingLeft: `${Math.max(28, 28 + (depth + 1) * 20)}px` }}
                    >
                      {/* Código e Descrição */}
                      <div className="flex items-center gap-2.5 min-w-0 pr-4">
                        {!isFinalized && (
                          <input
                            type="checkbox"
                            checked={selectedItemIds.includes(item.id)}
                            onChange={() => toggleItemSelection(item.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 flex-shrink-0"
                            aria-label={`Selecionar item ${item.composition.code}`}
                          />
                        )}
                        <span className="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-blue-100 text-blue-800 flex-shrink-0">
                          {item.composition.code}
                        </span>
                        <span className="text-slate-800 line-clamp-1">
                          {item.composition.description}
                        </span>
                        <span className="text-slate-400 font-mono text-[10px] flex-shrink-0">
                          [{item.composition.unit}]
                        </span>
                      </div>

                      {/* Quantidade, Custos e Subtotais */}
                      <div className="flex items-center gap-4 font-mono text-xs flex-shrink-0">
                        {/* Quantidade Editável */}
                        <div className="w-24 text-right">
                          {isEditingQty && !isFinalized ? (
                            <div className="flex items-center justify-end gap-1 font-sans">
                              <input
                                type="text"
                                value={tempQuantity}
                                onChange={(e) => setTempQuantity(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveQuantity(item.id);
                                  if (e.key === "Escape") {
                                    setEditingItemId(null);
                                    setTempQuantity("");
                                  }
                                }}
                                autoFocus
                                className="w-16 px-1.5 py-0.5 text-right font-mono bg-white border border-blue-500 rounded text-xs focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveQuantity(item.id)}
                                className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              data-quantity-item
                              ref={(node) => {
                                if (node) quantityRefs.current.set(item.id, node);
                                else quantityRefs.current.delete(item.id);
                              }}
                              onKeyDown={(e) => handleQuantityKeyDown(e, item.id)}
                              onClick={() => {
                                if (!isFinalized) {
                                  setEditingItemId(item.id);
                                  setTempQuantity(item.quantity);
                                }
                              }}
                              className={`text-slate-700 font-medium ${
                                !isFinalized ? "hover:underline hover:text-blue-600 cursor-pointer" : ""
                              }`}
                              title={!isFinalized ? "Clique para editar quantidade (↑/↓ navega)" : ""}
                            >
                              {Number(item.quantity).toFixed(2)}
                            </button>
                          )}
                        </div>

                        {/* Custo Unitário Direto */}
                        <span className="hidden sm:inline-block text-slate-500 w-24 text-right">
                          {formatBRL(Number(item.unitCostTotal))}
                        </span>

                        {/* BDI (%) */}
                        <div className="w-16 text-right">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              isBdiOverridden
                                ? "bg-amber-100 text-amber-800 border border-amber-200"
                                : "text-slate-500"
                            }`}
                            title={isBdiOverridden ? `BDI diferenciado: ${item.bdiOverride?.name}` : "BDI padrão da planilha"}
                          >
                            {Number(item.bdiRate).toFixed(1)}%
                          </span>
                        </div>

                        {/* Subtotal Direto */}
                        <span className="hidden md:inline-block text-slate-600 w-28 text-right font-medium">
                          {formatBRL(itemDirect)}
                        </span>

                        {/* Subtotal c/ BDI */}
                        <span className="text-slate-900 w-32 text-right font-bold">
                          {formatBRL(itemWithBdi)}
                        </span>

                        {/* Ações do Item */}
                        {!isFinalized ? (
                          <div className="flex items-center gap-1 font-sans">
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(item.id, item.composition.description)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Remover Item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="w-6" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Subetapas filhas recursivas */}
            {stage.childStages && stage.childStages.length > 0 && (
              <div>
                {stage.childStages.map((child) => renderStage(child, depth + 1))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Notificação Toast */}
      {actionMessage && (
        <div
          className={`p-4 rounded-2xl flex items-center justify-between text-xs font-semibold shadow-sm transition-all ${
            actionMessage.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="p-1 text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header com Navegação e Metadados */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Link
                href="/budgets"
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar aos Orçamentos</span>
              </Link>
              <span className="text-slate-300">•</span>
              <span className="text-xs font-medium text-slate-600">
                {project.name}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                {budgetTitle}
              </h1>

              {budgetDescription && (
                <span className="text-xs text-slate-500 max-w-md truncate">
                  {budgetDescription}
                </span>
              )}

              {/* Badge de Status da Revisão */}
              {isFinalized ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Finalizado 🔒 Imutável</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  <FileEdit className="w-4 h-4 text-amber-600" />
                  <span>Em Elaboração (Rascunho)</span>
                </div>
              )}
            </div>
          </div>

          {/* Seletor de Revisões e Toolbar de Ações */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Seletor de Revisão */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
              <span className="text-xs text-slate-500 font-medium">Revisão:</span>
              <select
                value={activeRevisionId}
                onChange={(e) => setActiveRevisionId(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none cursor-pointer"
              >
                {revisions.map((rev) => (
                  <option key={rev.id} value={rev.id}>
                    Rev. {rev.revisionNumber} {rev.status === "FINALIZED" ? "🔒 [Finalizada]" : "[Rascunho]"}
                  </option>
                ))}
              </select>
            </div>

            {/* Botão Nova Etapa Raiz */}
            {!isFinalized && (
              <button
                type="button"
                onClick={() => {
                  setParentStageForNew(null);
                  setEditingStage(null);
                  setStageModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Etapa Raiz</span>
              </button>
            )}

            {/* Botão Renumerar EAP */}
            {!isFinalized && (
              <button
                type="button"
                onClick={handleRenumberStages}
                disabled={loading}
                title="Renumera automaticamente a EAP (1, 1.1, 2, ...)"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <Hash className="w-3.5 h-3.5" />
                <span>Renumerar</span>
              </button>
            )}

            {/* Botão Salvar Modelo */}
            {!isFinalized && (
              <button
                type="button"
                onClick={() => setTemplateModalOpen(true)}
                disabled={loading}
                title="Salvar a estrutura desta revisão como modelo de EAP"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Salvar Modelo</span>
              </button>
            )}

            {/* Botão Aplicar Modelo */}
            {!isFinalized && templates.length > 0 && (
              <button
                type="button"
                onClick={() => setApplyTemplateModalOpen(true)}
                disabled={loading}
                title="Inserir um modelo de EAP nesta revisão"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Aplicar Modelo</span>
              </button>
            )}

            {/* Botão Importar Planilha */}
            {!isFinalized && (
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                disabled={loading}
                title="Importar itens de orçamento em CSV ou XLSX, com associação por código e resolução de conflitos"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Importar Planilha</span>
              </button>
            )}

            {/* Botão Auditoria */}
            <button
              type="button"
              onClick={() => setAuditModalOpen(true)}
              disabled={loading}
              title="Executar as regras de auditoria crítica e alertas desta revisão"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              <span>Auditar</span>
            </button>

            {/* Botão Recalcular */}
            {!isFinalized && (
              <button
                type="button"
                onClick={handleRecalculate}
                disabled={loading}
                title="Sincroniza custos com a base de dados e recalcula subtotais determinísticos"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                <span>Recalcular</span>
              </button>
            )}

            {/* Botão Nova Revisão */}
            <button
              type="button"
              onClick={handleCreateNewRevision}
              disabled={loading}
              title="Clona a revisão atual gerando a próxima revisão editável"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Nova Revisão</span>
            </button>

            {/* Botão Finalizar Orçamento */}
            {!isFinalized && (
              <button
                type="button"
                onClick={() => setFinalizeModalOpen(true)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Finalizar Planilha</span>
              </button>
            )}
          </div>
        </div>

        {/* Detalhes de Referência e Selo Criptográfico */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              <strong>Base:</strong> {activeRevision.referenceState || "BR"} • {activeRevision.referenceMonth || "Geral"}
              {activeRevision.referenceTaxRegime ? ` (${activeRevision.referenceTaxRegime})` : ""}
            </span>
            <span>
              <strong>BDI Padrão:</strong> {activeRevision.bdiConfig ? `${activeRevision.bdiConfig.name} (${Number(activeRevision.bdiConfig.bdiRate).toFixed(2)}%)` : "0,00%"}
            </span>
            {activeRevision.technicalResponsible && (
              <span><strong>Resp. Técnico:</strong> {activeRevision.technicalResponsible}</span>
            )}
            <span><strong>Regra de Arredondamento:</strong> {activeRevision.roundingMode}</span>
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Keyboard className="w-3.5 h-3.5" />
              <span>/ busca · ↑↓ navega · Ctrl+Enter recalcula · Del remove seleção</span>
            </span>
          </div>

          {/* Selo SHA-256 se Finalizada */}
          {activeRevision.snapshot && (
            <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-200 text-emerald-800">
              <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="font-mono text-[11px] truncate max-w-xs" title={activeRevision.snapshot.checksum}>
                SHA-256: {activeRevision.snapshot.checksum.slice(0, 16)}...
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(activeRevision.snapshot!.checksum)}
                className="p-1 hover:text-emerald-950 font-bold"
                title="Copiar Checksum SHA-256 Completo"
              >
                {copiedSha ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards de Totais Financeiros */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Custo Direto Total
          </p>
          <p className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {formatBRL(budgetTotals.direct)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Soma dos insumos e serviços
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            BDI Médio Efetivo
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold text-blue-600 font-mono">
              {budgetTotals.effectiveBdi.toFixed(2)}%
            </span>
            <span className="text-xs text-slate-500 font-mono">
              (+{formatBRL(budgetTotals.bdiAmount)})
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Margens, encargos e impostos
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
            Valor Global da Obra
          </p>
          <p className="text-2xl font-black text-slate-900 mt-1 font-mono">
            {formatBRL(budgetTotals.withBdi)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Total com BDI aplicado
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Estrutura da EAP
          </p>
          <p className="text-xl font-bold text-slate-900 mt-1 font-mono">
            {flatStagesList.length} <span className="text-xs text-slate-500 font-normal">etapas</span> • {budgetTotals.itemsCount} <span className="text-xs text-slate-500 font-normal">itens</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Árvore hierárquica do orçamento
          </p>
        </div>
      </div>

      {/* Planilha Orçamentária / Tabela EAP */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {/* Cabeçalho da Tabela */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-50/90 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
          <div className="flex items-center gap-2">
            {!isFinalized && allItemIds.length > 0 && (
              <input
                type="checkbox"
                checked={
                  selectedItemIds.length > 0 &&
                  selectedItemIds.length === allItemIds.length
                }
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedItemIds(allItemIds);
                    setSelectionPanelOpen(true);
                  } else {
                    clearSelection();
                  }
                }}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                aria-label="Selecionar todos os itens"
              />
            )}
            <span>Item / Discriminação dos Serviços</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-right">
            <span className="w-24">Quant.</span>
            <span className="hidden sm:inline-block w-24">Unit. (R$)</span>
            <span className="w-16">BDI</span>
            <span className="hidden md:inline-block w-28">Direto (R$)</span>
            <span className="w-32">Total c/ BDI</span>
            {!isFinalized && <span className="w-16 text-center">Ações</span>}
          </div>
        </div>

        {/* Corpo da Árvore */}
        {rootStagesList.length === 0 ? (
          <div className="p-12 text-center">
            <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h4 className="text-sm font-semibold text-slate-800">
              Nenhuma etapa cadastrada nesta revisão
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Adicione etapas para estruturar a EAP e inserir os itens de serviço.
            </p>
            {!isFinalized && (
              <button
                type="button"
                onClick={() => {
                  setParentStageForNew(null);
                  setEditingStage(null);
                  setStageModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-all mt-4"
              >
                <Plus className="w-4 h-4" />
                <span>Adicionar Primeira Etapa</span>
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rootStagesList.map((root) => renderStage(root, 0))}
          </div>
        )}

        {/* Rodapé Consolidado */}
        <div className="flex items-center justify-between px-4 py-4 bg-slate-900 text-white font-mono text-xs sm:text-sm font-bold">
          <span>TOTAL GERAL DO ORÇAMENTO</span>
          <div className="flex items-center gap-4 text-right">
            <span className="hidden sm:inline-block text-slate-400 font-medium">
              Direto: {formatBRL(budgetTotals.direct)}
            </span>
            <span className="text-emerald-400 text-base font-black">
              {formatBRL(budgetTotals.withBdi)}
            </span>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* DRAWER / MODAL DE BUSCA E ADIÇÃO DE COMPOSIÇÕES                     */}
      {/* ===================================================================== */}
      {searchDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header do Drawer */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Adicionar Item de Serviço
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Consulte o acervo de composições SINAPI, SICRO ou Próprias.
                </p>
              </div>
              <button
                onClick={() => setSearchDrawerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Corpo do Drawer */}
            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              {/* Seleção da Etapa de Destino */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Etapa de Destino na EAP <span className="text-red-500">*</span>
                </label>
                <select
                  value={targetStageIdForAdd}
                  onChange={(e) => setTargetStageIdForAdd(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {flatStagesList.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.code} — {st.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Cadastro de composição própria dentro do orçamento */}
              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setCreateCompOpen((prev) => !prev)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors"
                >
                  <span className="inline-flex items-center gap-2">
                    <Wrench className="w-3.5 h-3.5 text-blue-600" />
                    <span>Criar composição própria e incluir agora</span>
                  </span>
                  {createCompOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>

                {createCompOpen && (
                  <div className="p-4 space-y-3 bg-white">
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        placeholder="Código"
                        value={newCompCode}
                        onChange={(e) => setNewCompCode(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono"
                      />
                      <input
                        type="text"
                        placeholder="Unidade (m², un...)"
                        value={newCompUnit}
                        onChange={(e) => setNewCompUnit(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono"
                      />
                      <select
                        value={newCompType}
                        onChange={(e) => setNewCompType(e.target.value as CompositionType)}
                        className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white"
                      >
                        <option value={CompositionType.CLOSED}>Fechada</option>
                        <option value={CompositionType.ANALYTICAL}>Analítica</option>
                      </select>
                    </div>

                    <textarea
                      rows={2}
                      placeholder="Descrição técnica do serviço"
                      value={newCompDescription}
                      onChange={(e) => setNewCompDescription(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs"
                    />

                    {newCompType === CompositionType.CLOSED ? (
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Preço Total Fechado (R$)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={newCompClosedPrice}
                          onChange={(e) => setNewCompClosedPrice(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono"
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="block text-[11px] font-semibold text-slate-600">
                          Insumo componente
                        </label>
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            placeholder="Buscar insumo por código ou descrição..."
                            value={resourceQuery}
                            onChange={(e) => handleSearchResources(e.target.value)}
                            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 text-xs"
                          />
                        </div>

                        {selectedResource ? (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50 border border-blue-200 text-xs">
                            <span className="truncate">
                              <strong className="font-mono">{selectedResource.code}</strong>{" "}
                              {selectedResource.description} [{selectedResource.unit}]
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedResource(null)}
                              className="p-1 text-slate-400 hover:text-red-600"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          resourceResults.length > 0 && (
                            <div className="max-h-28 overflow-y-auto space-y-1">
                              {resourceResults.map((resource) => (
                                <button
                                  key={resource.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedResource(resource);
                                    setResourceResults([]);
                                    setResourceQuery("");
                                  }}
                                  className="w-full text-left p-2 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 text-[11px]"
                                >
                                  <span className="font-mono font-bold text-blue-700">
                                    {resource.code}
                                  </span>{" "}
                                  {resource.description} [{resource.unit}] —{" "}
                                  {formatBRL(Number(resource.price))}
                                </button>
                              ))}
                            </div>
                          )
                        )}

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Coeficiente de consumo
                          </label>
                          <input
                            type="text"
                            value={resourceCoefficient}
                            onChange={(e) => setResourceCoefficient(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono"
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleCreateCompositionInBudget}
                      disabled={loading}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                    >
                      {loading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      <span>Criar e Adicionar à Planilha</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Campo de Busca */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Digite o código (ex: 98459) ou palavras-chave..."
                  value={searchQuery}
                  onChange={(e) => handleSearchCompositions(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                {searchingComps && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-blue-600" />
                )}
              </div>

              {/* Resultados da Busca */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Composições Disponíveis
                </p>

                {compResults.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl">
                    <p className="text-xs text-slate-400">
                      {searchQuery.length < 2
                        ? "Digite pelo menos 2 caracteres para pesquisar."
                        : "Nenhuma composição encontrada para os termos digitados."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {compResults.map((comp) => {
                      const isSelected = selectedComp?.id === comp.id;
                      const totalCost = Number(comp.unitCostTotal || 0);
                      return (
                        <div
                          key={comp.id}
                          onClick={() => setSelectedComp(comp)}
                          className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                            isSelected
                              ? "bg-blue-50/70 border-blue-500 shadow-xs ring-1 ring-blue-500"
                              : "bg-white border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                              {comp.code}
                            </span>
                            <span className="font-mono font-bold text-slate-900">
                              {formatBRL(totalCost)} / {comp.unit}
                            </span>
                          </div>
                          <p className="text-slate-800 line-clamp-2 mt-1">
                            {comp.description}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Parâmetros do Item Selecionado */}
              {selectedComp && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                  <p className="text-xs font-bold text-slate-900">
                    Configurar Quantidade e BDI do Item
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Quantidade ({selectedComp.unit})
                      </label>
                      <input
                        type="text"
                        value={itemQuantity}
                        onChange={(e) => setItemQuantity(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Sobrescrever BDI (Opcional)
                      </label>
                      <select
                        value={itemBdiOverrideId}
                        onChange={(e) => setItemBdiOverrideId(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium"
                      >
                        <option value="">Usar BDI padrão da planilha</option>
                        {bdiConfigs.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({Number(b.bdiRate).toFixed(2)}%)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Prévia Financeira do Item */}
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
                    <div>
                      <p className="text-[10px] text-slate-400">Subtotal Direto Previsto</p>
                      <p className="font-mono font-bold text-slate-700">
                        {formatBRL(Number(selectedComp.unitCostTotal || 0) * (Number(itemQuantity) || 0))}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCompToBudget}
                      disabled={loading}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 transition-all flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Adicionar à Planilha</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE ETAPA                                  */}
      {/* ===================================================================== */}
      {stageModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900">
              {editingStage ? "Editar Etapa" : parentStageForNew ? "Nova Subetapa" : "Nova Etapa Raiz"}
            </h3>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const code = (form.elements.namedItem("code") as HTMLInputElement).value;
                const title = (form.elements.namedItem("title") as HTMLInputElement).value;

                setLoading(true);
                let res;
                if (editingStage) {
                  res = await updateStage({ stageId: editingStage.id, code, title });
                } else {
                  res = await createStage({
                    budgetRevisionId: activeRevision.id,
                    parentStageId: parentStageForNew,
                    code,
                    title,
                  });
                }
                setLoading(false);
                setStageModalOpen(false);

                if (res.success) {
                  router.refresh();
                } else {
                  showNotice("error", res.error || "Erro ao salvar etapa.");
                }
              }}
              className="space-y-4 text-xs"
            >
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Código da Etapa{" "}
                  <span className="font-normal text-slate-400">
                    (opcional — automático: 1, 1.1, 2...)
                  </span>
                </label>
                <input
                  name="code"
                  defaultValue={editingStage ? editingStage.code : ""}
                  placeholder="Deixe em branco para numeração automática"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Título da Etapa (Ex.: SERVIÇOS PRELIMINARES)
                </label>
                <input
                  name="title"
                  defaultValue={editingStage ? editingStage.title : ""}
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStageModalOpen(false)}
                  className="px-3 py-2 border border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-xs"
                >
                  Salvar Etapa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL DE FINALIZAÇÃO (SNAPSHOT CRIPTOGRÁFICO SHA-256)               */}
      {/* ===================================================================== */}
      {finalizeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 flex-shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Finalizar Revisão do Orçamento
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Geração de Snapshot Imutável e Checksum Criptográfico SHA-256
                </p>
              </div>
            </div>

            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-2">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Atenção: Ação Irreversível de Congelamento
              </p>
              <p>
                Ao finalizar a Revisão {activeRevision.revisionNumber}, todos os preços, coeficientes, BDI e totais serão gravados de forma <strong>estritamente imutável</strong>.
              </p>
              <p>
                Futuras atualizações ou aditivos exigirão a criação de uma <strong>Nova Revisão (Rev. {activeRevision.revisionNumber + 1})</strong>, mantendo o histórico de auditoria intacto.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl font-mono text-xs space-y-1">
              <div className="flex justify-between text-slate-600">
                <span>Custo Direto:</span>
                <span>{formatBRL(budgetTotals.direct)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>BDI Efetivo:</span>
                <span>{budgetTotals.effectiveBdi.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200">
                <span>Total Global:</span>
                <span className="text-emerald-700">{formatBRL(budgetTotals.withBdi)}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFinalizeModalOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 text-xs font-semibold hover:bg-slate-50"
              >
                Voltar e Continuar Editando
              </button>
              <button
                type="button"
                onClick={handleFinalize}
                disabled={loading}
                className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 shadow-md shadow-emerald-600/20 flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                <span>Confirmar e Selar Revisão</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AUDITORIA CRÍTICA E ALERTAS */}
      {auditModalOpen && activeRevision && (
        <RevisionAuditModal
          revisionId={activeRevision.id}
          revisionNumber={activeRevision.revisionNumber}
          isFinalized={isFinalized}
          onClose={() => setAuditModalOpen(false)}
        />
      )}

      {/* MODAL DE IMPORTAÇÃO DE PLANILHA (CSV/XLSX) */}
      {importModalOpen && activeRevision && (
        <BudgetImportModal
          revisionId={activeRevision.id}
          revisionNumber={activeRevision.revisionNumber}
          onClose={() => setImportModalOpen(false)}
          onImported={() => router.refresh()}
        />
      )}

      {/* ===================================================================== */}
      {/* PAINEL LATERAL DE SELEÇÃO MÚLTIPLA                                   */}
      {/* ===================================================================== */}
      {selectionPanelOpen && selectedItems.length > 0 && (
        <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={() => setSelectionPanelOpen(false)}>
          <aside
            className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                  <PanelRight className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    {selectedItems.length} item(ns) selecionado(s)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Ações em lote sobre a planilha
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectionPanelOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {selectedItems.map((item) => (
                <div key={item.id} className="p-3.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                      {item.composition.code}
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      {formatBRL(Number(item.subtotalWithBdi || 0))}
                    </span>
                  </div>
                  <p className="text-slate-700 line-clamp-2">{item.composition.description}</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>
                      {Number(item.quantity).toFixed(2)} {item.composition.unit} ×{" "}
                      {formatBRL(Number(item.unitCostTotal || 0))}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleItemSelection(item.id)}
                      className="text-slate-400 hover:text-red-600"
                      title="Remover da seleção"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-200 space-y-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Total direto</span>
                  <span>{formatBRL(selectedTotals.direct)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200">
                  <span>Total com BDI</span>
                  <span className="text-emerald-700">{formatBRL(selectedTotals.withBdi)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearSelection}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  Limpar seleção
                </button>
                {!isFinalized && (
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    disabled={loading}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remover itens</span>
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: SALVAR MODELO DE EAP                                          */}
      {/* ===================================================================== */}
      {templateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Save className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-base text-slate-900">Salvar Modelo de EAP</h3>
            </div>
            <p className="text-xs text-slate-500">
              A estrutura hierárquica e as quantidades dos itens desta revisão serão salvas
              como modelo reutilizável. Custos não são congelados: ao aplicar, serão
              recalculados com o catálogo atual.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nome do Modelo</label>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Ex.: Modelo Residencial Padrão"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Descrição (opcional)
                </label>
                <textarea
                  rows={2}
                  value={templateDescription}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-slate-600 text-xs font-semibold hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Salvar Modelo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: APLICAR MODELO DE EAP                                         */}
      {/* ===================================================================== */}
      {applyTemplateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-base text-slate-900">Aplicar Modelo de EAP</h3>
            </div>
            <p className="text-xs text-slate-500">
              As etapas e itens do modelo serão adicionados à revisão atual, com numeração
              automática e custos recalculados.
            </p>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(template.id)}
                  className={`w-full text-left p-3 rounded-xl border text-xs transition-all ${
                    selectedTemplateId === template.id
                      ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{template.name}</span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {template.stageCount} etapas · {template.itemCount} itens
                    </span>
                  </div>
                  {template.description && (
                    <p className="text-slate-500 mt-1 line-clamp-2">{template.description}</p>
                  )}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setApplyTemplateModalOpen(false)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-slate-600 text-xs font-semibold hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApplyTemplate}
                disabled={loading || !selectedTemplateId}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
                <span>Aplicar Modelo</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
