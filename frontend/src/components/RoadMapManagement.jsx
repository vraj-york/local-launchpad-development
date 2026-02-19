import React, { useState } from "react";
import { Check, MoreVertical, Plus, X, AlertCircle, Zap } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { PageHeader } from "./PageHeader";
import { DatePickerWithRange } from "./ui/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { format } from "date-fns";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

function RoadMapManagement({
  value,
  onChange,
  isEmbedded = false,
  readOnly = false,
  onRoadmapUpdate,
  onRoadmapDelete,
  onItemDelete,
  validationErrors = {},
  initialEditingId = null,
}) {
  const [localErrors, setLocalErrors] = useState({});

  // ... (internalRoadmaps state remains same)
  const [internalRoadmaps, setInternalRoadmaps] = useState([
    {
      id: "1",
      title: "Q1 2026 Roadmap",
      description: "Foundation phase",
      status: "COMPLETED",
      tshirtSize: "M",
      timelineStart: "2026-01-01",
      timelineEnd: "2026-03-31",
      items: [
        {
          id: "1-1",
          title: "Authentication System",
          description: "Login & JWT implementation",
          type: "FEATURE",
          status: "COMPLETED",
          priority: "HIGH",
          startDate: "2026-01-01",
          endDate: "2026-01-15",
        },
      ],
    },
  ]);

  const roadmaps = value !== undefined ? value : internalRoadmaps;

  console.log(roadmaps, "roadmaps");

  const setRoadmaps = (newRoadmaps) => {
    if (onChange) {
      onChange(newRoadmaps);
    } else {
      setInternalRoadmaps(newRoadmaps);
    }
  };
  // Helper to format ISO date to YYYY-MM-DD for input
  const toInputDate = (isoString) => {
    if (!isoString) return "";
    try {
      return new Date(isoString).toISOString().split("T")[0];
    } catch (e) {
      return "";
    }
  };

  // Initialize editingId with prop
  const [editingId, setEditingId] = useState(initialEditingId);

  // Initialize form state if editingId is provided
  const getInitialEditForm = () => {
    if (initialEditingId) {
      const initialRoadmap = roadmaps.find((r) => r.id === initialEditingId);
      if (initialRoadmap) {
        return {
          title: initialRoadmap.title,
          description: initialRoadmap.description || "",
          status: initialRoadmap.status || "DRAFT",
          tshirtSize: initialRoadmap.tshirtSize || "M",
          timelineStart: toInputDate(initialRoadmap.timelineStart),
          timelineEnd: toInputDate(initialRoadmap.timelineEnd),
          items: initialRoadmap.items.map((item) => ({
            ...item,
            startDate: toInputDate(item.startDate),
            endDate: toInputDate(item.endDate),
          })),
        };
      }
    }
    return {
      title: "",
      description: "",
      status: "DRAFT",
      tshirtSize: "M",
      timelineStart: "",
      timelineEnd: "",
      items: [],
    };
  };

  const [editForm, setEditForm] = useState(getInitialEditForm());

  const calculateProgress = (items) => {
    if (items.length === 0) return 0;
    const completed = items.filter(
      (item) => item.status === "COMPLETED",
    ).length;
    return (completed / items.length) * 100;
  };

  const hasRoadmapErrors = (roadmap) => {
    if (!validationErrors) return false;
    // Check roadmap specific errors
    if (
      validationErrors[`roadmap-${roadmap.id}-title`] ||
      validationErrors[`roadmap-${roadmap.id}-timelineStart`] ||
      validationErrors[`roadmap-${roadmap.id}-timelineEnd`] ||
      localErrors[`roadmap-${roadmap.id}-title`] ||
      localErrors[`roadmap-${roadmap.id}-timelineStart`] ||
      localErrors[`roadmap-${roadmap.id}-timelineEnd`]
    ) {
      return true;
    }
    // Check item errors
    if (
      roadmap.items?.some(
        (item) =>
          validationErrors[`item-${item.id}-title`] ||
          validationErrors[`item-${item.id}-startDate`] ||
          validationErrors[`item-${item.id}-endDate`],
      )
    ) {
      return true;
    }
    return false;
  };

  const handleAddRoadmap = () => {
    setLocalErrors({});
    const newRoadmap = {
      id: Date.now().toString(),
      isTemp: true,
      title: "New Roadmap",
      description: "Add description...",
      status: "DRAFT",
      items: [
        {
          id: `${Date.now()}-1`,
          title: "New item",
          description: "",
          status: "PLANNED",
          type: "FEATURE",
          priority: "MEDIUM",
        },
      ],
    };
    // No change here, raw object added to roadmaps
    setRoadmaps([...roadmaps, newRoadmap]);
    setEditingId(newRoadmap.id);
    // Map to form format
    setEditForm({
      title: newRoadmap.title,
      description: newRoadmap.description || "",
      status: newRoadmap.status || "DRAFT",
      tshirtSize: newRoadmap.tshirtSize || "M",
      timelineStart: toInputDate(newRoadmap.timelineStart),
      timelineEnd: toInputDate(newRoadmap.timelineEnd),
      items: newRoadmap.items.map((item) => ({
        ...item,
        startDate: toInputDate(item.startDate),
        endDate: toInputDate(item.endDate),
      })),
    });
  };

  const handleEditClick = (roadmap) => {
    setLocalErrors({});
    setEditingId(roadmap.id);
    setEditForm({
      title: roadmap.title,
      description: roadmap.description || "",
      status: roadmap.status || "DRAFT",
      tshirtSize: roadmap.tshirtSize || "M",
      timelineStart: toInputDate(roadmap.timelineStart),
      timelineEnd: toInputDate(roadmap.timelineEnd),
      items: roadmap.items.map((item) => ({
        ...item,
        startDate: toInputDate(item.startDate),
        endDate: toInputDate(item.endDate),
      })),
    });
  };

  const handleSave = async () => {
    if (!editingId) return;

    // Validation
    const newErrors = {};
    if (!editForm.title?.trim())
      newErrors[`roadmap-${editingId}-title`] = "Title is required";
    if (!editForm.timelineStart)
      newErrors[`roadmap-${editingId}-timelineStart`] =
        "Start date is required";
    if (!editForm.timelineEnd)
      newErrors[`roadmap-${editingId}-timelineEnd`] = "End date is required";

    editForm.items.forEach((item) => {
      if (!item.title?.trim())
        newErrors[`item-${item.id}-title`] = "Title is required";
      if (!item.startDate)
        newErrors[`item-${item.id}-startDate`] = "Start date is required";
      if (!item.endDate)
        newErrors[`item-${item.id}-endDate`] = "End date is required";
    });

    if (Object.keys(newErrors).length > 0) {
      setLocalErrors(newErrors);
      return;
    }
    setLocalErrors({});

    // Convert dates back to ISO string for backend/storage
    const toISO = (dateStr) => {
      if (!dateStr) return null;
      return new Date(dateStr).toISOString();
    };

    // Create the updated version of the edited roadmap
    let updatedRoadmap = null;
    const newRoadmaps = roadmaps.map((roadmap) => {
      if (roadmap.id === editingId) {
        updatedRoadmap = {
          ...roadmap,
          title: editForm.title,
          description: editForm.description,
          status: editForm.status,
          tshirtSize: editForm.tshirtSize,
          timelineStart: toISO(editForm.timelineStart),
          timelineEnd: toISO(editForm.timelineEnd),
          items: editForm.items.map((item) => ({
            ...item,
            startDate: toISO(item.startDate),
            endDate: toISO(item.endDate),
          })),
        };
        // Remove internal flags
        if (updatedRoadmap.isTemp) delete updatedRoadmap.isTemp;
        return updatedRoadmap;
      }
      return roadmap;
    });

    // Trigger external update handler if provided
    if (onRoadmapUpdate && updatedRoadmap) {
      try {
        // Sanitize payload: Remove temporary IDs (strings) from roadmap and items
        // Real IDs from backend are numbers. Temp IDs are strings (Date.now().toString()).
        const payload = { ...updatedRoadmap };

        // If roadmap ID is a string (temporary ID from frontend), it's a new roadmap -> remove ID so backend generates a new one.
        // Assuming backend uses integer IDs or different format for real IDs. If backend uses UUID strings, we might need a better check (e.g. isNaN).
        // For now, our temp IDs are `Date.now().toString()` which are numeric strings.
        if (typeof payload.id === "string") {
          delete payload.id;
        }

        // Sanitize items
        if (payload.items && Array.isArray(payload.items)) {
          payload.items = payload.items.map((item) => {
            const newItem = { ...item };
            // Same check for items: if ID is string (temp), remove it.
            if (typeof newItem.id === "string") {
              delete newItem.id;
            }
            return newItem;
          });
        }

        // Determine if we should send items formatted or as-is.
        // Backend expects items in the payload.
        const serverRoadmap = await onRoadmapUpdate(payload);
        if (serverRoadmap) {
          updatedRoadmap = serverRoadmap;
        }
      } catch (error) {
        console.error("Failed to update roadmap:", error);
        // Optionally show error to user/prevent closing
        return; // Prevent closing on error
      }
    }

    // Re-calculate newRoadmaps with potentially updated data (e.g. real IDs)
    const finalRoadmaps = roadmaps.map((roadmap) =>
      roadmap.id === editingId ? updatedRoadmap : roadmap,
    );

    setRoadmaps(finalRoadmaps);
    setEditingId(null);
  };

  const handleCancel = () => {
    // If canceling a temporary roadmap, remove it from the list
    const currentRoadmap = roadmaps.find((r) => r.id === editingId);
    if (currentRoadmap?.isTemp) {
      setRoadmaps(roadmaps.filter((r) => r.id !== editingId));
    }
    setEditingId(null);
  };

  const handleDelete = async (id) => {
    if (typeof id === "string") {
      console.log("String id found", id);
      setRoadmaps(roadmaps.filter((roadmap) => roadmap.id !== id));
      return;
    }

    if (onRoadmapDelete) {
      await onRoadmapDelete(id);
    } else {
      setRoadmaps(roadmaps.filter((roadmap) => roadmap.id !== id));
    }
  };

  const toggleItemStatus = (roadmapId, itemId) => {
    if (readOnly) return;
    setRoadmaps(
      roadmaps.map((roadmap) =>
        roadmap.id === roadmapId
          ? {
              ...roadmap,
              items: roadmap.items.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      status:
                        item.status === "COMPLETED"
                          ? "PLANNED"
                          : item.status === "PLANNED"
                            ? "IN_PROGRESS"
                            : "COMPLETED",
                    }
                  : item,
              ),
            }
          : roadmap,
      ),
    );
  };

  const addItem = () => {
    setEditForm({
      ...editForm,
      items: [
        ...editForm.items,
        {
          id: `${Date.now()}`,
          title: "",
          description: "",
          status: "PLANNED",
          type: "FEATURE",
          priority: "MEDIUM",
          startDate: "",
          endDate: "",
        },
      ],
    });
  };

  const updateItem = (itemId, field, value) => {
    setEditForm({
      ...editForm,
      items: editForm.items.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item,
      ),
    });
  };

  const removeItem = async (itemId) => {
    if (onItemDelete) {
      const originalRoadmap = roadmaps.find((r) => r.id === editingId);
      const originalItem = originalRoadmap?.items.find((i) => i.id === itemId);

      if (
        originalItem &&
        typeof editingId === "number" &&
        typeof itemId === "number"
      ) {
        await onItemDelete(editingId, itemId);
      }
    }

    setEditForm({
      ...editForm,
      items: editForm.items.filter((item) => item.id !== itemId),
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "COMPLETED":
        return "text-emerald-600 bg-emerald-50";
      case "IN_PROGRESS":
        return "text-blue-600 bg-blue-50";
      case "PLANNED":
        return "text-slate-600 bg-slate-50";
      default:
        return "text-slate-600 bg-slate-50";
    }
  };

  const getPriorityIcon = (priority) => {
    if (priority === "HIGH") {
      return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    } else if (priority === "MEDIUM") {
      return <Zap className="w-3.5 h-3.5 text-orange-500" />;
    }
    return null;
  };

  return (
    <div
      className={`${isEmbedded ? "" : "min-h-screen bg-gray-50 p-8"} rounded-xl`}
    >
      <div className="mx-auto max-w-5xl">
        {!isEmbedded && (
          <PageHeader
            title="Project Roadmap"
            description="Track project milestones and development progress"
          />
        )}

        {!readOnly && (
          <div className="mb-6">
            <Button onClick={handleAddRoadmap} className="gap-2">
              <Plus className="w-4 h-4" />
              Add Roadmap
            </Button>
          </div>
        )}

        <div className="relative pl-8">
          {/* Vertical Timeline Line */}
          <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-slate-200" />

          <div className="space-y-0">
            {roadmaps.map((roadmap, index) => {
              const progress = calculateProgress(roadmap.items);
              const isCompleted = progress === 100;

              return (
                <div key={roadmap.id} className="relative">
                  {/* Progress Timeline Fill */}
                  <div
                    className={`absolute -left-[25px] top-0 w-2 bg-emerald-500 transition-all duration-500 ${isCompleted && index !== roadmaps.length - 1 ? "rounded-t-full h-[calc(100%+10px)]" : "rounded-full"}`}
                    style={{
                      height:
                        isCompleted && index !== roadmaps.length - 1
                          ? "calc(100% + 10px)"
                          : `${progress}%`,
                      minHeight: isCompleted ? "20px" : "0px",
                    }}
                  />

                  {/* Timeline Node */}
                  <div className="absolute -left-[35px] top-0 z-10">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                        isCompleted
                          ? "bg-emerald-500"
                          : progress > 0
                            ? "bg-blue-500"
                            : "bg-slate-300"
                      }`}
                    >
                      {isCompleted && (
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      )}
                    </div>
                  </div>

                  {/* Card */}
                  <div
                    className={`ml-6 ${index === roadmaps.length - 1 ? "mb-10" : "pb-10"}`}
                  >
                    <div
                      className={`bg-white rounded-lg border transition-all ${
                        editingId === roadmap.id
                          ? "border-emerald-500 shadow-lg"
                          : hasRoadmapErrors(roadmap)
                            ? "border-destructive shadow-sm"
                            : "border-gray-200 hover:border-gray-300 shadow-sm"
                      }`}
                    >
                      <div className="p-6">
                        {editingId === roadmap.id ? (
                          // Edit Mode
                          <div className="space-y-6">
                            {/* Roadmap Details Section */}
                            <div className="space-y-4 pb-4 border-b border-slate-200">
                              <h4 className="font-semibold text-slate-800">
                                Roadmap Details
                              </h4>

                              <div className="grid grid-cols-2 gap-3">
                                <div className="grid grid-cols-2 col-span-2 gap-4">
                                  <div className="w-full">
                                    <label className="block text-xs font-medium text-slate-600 mb-1.5">
                                      Title
                                    </label>
                                    <Input
                                      value={editForm.title}
                                      onChange={(e) =>
                                        setEditForm({
                                          ...editForm,
                                          title: e.target.value,
                                        })
                                      }
                                      placeholder="Q1 2026 Roadmap"
                                      autoFocus
                                      className={
                                        validationErrors[
                                          `roadmap-${editingId}-title`
                                        ] ||
                                        localErrors[
                                          `roadmap-${editingId}-title`
                                        ]
                                          ? "border-destructive w-full"
                                          : "w-full"
                                      }
                                    />
                                    {(validationErrors[
                                      `roadmap-${editingId}-title`
                                    ] ||
                                      localErrors[
                                        `roadmap-${editingId}-title`
                                      ]) && (
                                      <span className="text-xs text-destructive mt-1">
                                        {validationErrors[
                                          `roadmap-${editingId}-title`
                                        ] ||
                                          localErrors[
                                            `roadmap-${editingId}-title`
                                          ]}
                                      </span>
                                    )}
                                  </div>

                                  <div className="w-full">
                                    <label className="text-xs font-medium text-slate-600 mb-1.5 flex justify-between">
                                      Timeline (Start - End)
                                    </label>
                                    <DatePickerWithRange
                                      date={{
                                        from: editForm.timelineStart
                                          ? new Date(editForm.timelineStart)
                                          : undefined,
                                        to: editForm.timelineEnd
                                          ? new Date(editForm.timelineEnd)
                                          : undefined,
                                      }}
                                      setDate={(range) => {
                                        setEditForm({
                                          ...editForm,
                                          timelineStart: range?.from
                                            ? format(range.from, "yyyy-MM-dd")
                                            : "",
                                          timelineEnd: range?.to
                                            ? format(range.to, "yyyy-MM-dd")
                                            : "",
                                        });
                                      }}
                                      className={
                                        validationErrors[
                                          `roadmap-${editingId}-timelineStart`
                                        ] ||
                                        validationErrors[
                                          `roadmap-${editingId}-timelineEnd`
                                        ] ||
                                        localErrors[
                                          `roadmap-${editingId}-timelineStart`
                                        ] ||
                                        localErrors[
                                          `roadmap-${editingId}-timelineEnd`
                                        ]
                                          ? "border-destructive w-full"
                                          : "w-full"
                                      }
                                    />
                                    {(validationErrors[
                                      `roadmap-${editingId}-timelineStart`
                                    ] ||
                                      validationErrors[
                                        `roadmap-${editingId}-timelineEnd`
                                      ] ||
                                      localErrors[
                                        `roadmap-${editingId}-timelineStart`
                                      ] ||
                                      localErrors[
                                        `roadmap-${editingId}-timelineEnd`
                                      ]) && (
                                      <p className="text-xs text-destructive mt-1">
                                        {validationErrors[
                                          `roadmap-${editingId}-timelineStart`
                                        ] ||
                                          localErrors[
                                            `roadmap-${editingId}-timelineStart`
                                          ] ||
                                          validationErrors[
                                            `roadmap-${editingId}-timelineEnd`
                                          ] ||
                                          localErrors[
                                            `roadmap-${editingId}-timelineEnd`
                                          ]}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="col-span-2">
                                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                                    Description
                                  </label>
                                  <Textarea
                                    value={editForm.description}
                                    onChange={(e) =>
                                      setEditForm({
                                        ...editForm,
                                        description: e.target.value,
                                      })
                                    }
                                    placeholder="Foundation phase..."
                                    rows={2}
                                  />
                                </div>

                                <div>
                                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                                    Status
                                  </label>
                                  <Select
                                    value={editForm.status}
                                    onValueChange={(value) =>
                                      setEditForm({
                                        ...editForm,
                                        status: value,
                                      })
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="DRAFT">
                                        Draft
                                      </SelectItem>
                                      <SelectItem value="ACTIVE">
                                        Active
                                      </SelectItem>
                                      <SelectItem value="COMPLETED">
                                        Completed
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div>
                                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                                    T-Shirt Size
                                  </label>
                                  <Select
                                    value={editForm.tshirtSize}
                                    onValueChange={(value) =>
                                      setEditForm({
                                        ...editForm,
                                        tshirtSize: value,
                                      })
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select size" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="XS">XS</SelectItem>
                                      <SelectItem value="S">S</SelectItem>
                                      <SelectItem value="M">M</SelectItem>
                                      <SelectItem value="L">L</SelectItem>
                                      <SelectItem value="XL">XL</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </div>

                            {/* Items Section */}
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="font-semibold text-slate-800">
                                  Roadmap Items ({editForm.items.length})
                                </h4>
                                <Button
                                  onClick={addItem}
                                  size="sm"
                                  className="text-sm font-medium flex items-center gap-1"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  Add Item
                                </Button>
                              </div>

                              <div className="space-y-3">
                                {editForm.items.map((item, idx) => (
                                  <div
                                    key={item.id}
                                    className="border border-slate-200 rounded-lg p-4 space-y-3 bg-primary-foreground"
                                  >
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium text-slate-500">
                                          Item {idx + 1}
                                        </span>

                                        <div className="flex flex-wrap gap-1.5 items-center">
                                          {Array.isArray(
                                            item?.projectVersions,
                                          ) &&
                                            item.projectVersions.length > 0 &&
                                            item.projectVersions.map((pv) => (
                                              <Badge
                                                key={pv.id ?? pv.version}
                                                className="rounded-sm"
                                                size="sm"
                                              >
                                                {pv.release?.name ?? "—"} (
                                                v{pv.version})
                                              </Badge>
                                            ))}
                                        </div>
                                      </div>

                                      {editForm.items.length > 1 &&
                                        (Array.isArray(item?.projectVersions) &&
                                        item.projectVersions.length > 0 ? (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className="inline-block w-fit cursor-not-allowed">
                                                <Button
                                                  className="text-red-600 hover:text-red-600 transition-colors"
                                                  variant="ghost"
                                                  disabled
                                                >
                                                  <X className="w-4 h-4" />
                                                </Button>
                                              </span>
                                            </TooltipTrigger>

                                            <TooltipContent>
                                              <p>
                                                You cannot remove this item
                                                because it is already linked to
                                                a project version
                                              </p>
                                            </TooltipContent>
                                          </Tooltip>
                                        ) : (
                                          <Button
                                            onClick={() => removeItem(item.id)}
                                            className="text-red-600 hover:text-red-600 transition-colors"
                                            variant="ghost"
                                          >
                                            <X className="w-4 h-4" />
                                          </Button>
                                        ))}
                                    </div>

                                    <div className="space-y-2.5">
                                      <div className="grid grid-cols-2 col-span-2 gap-4">
                                        <div>
                                          <label className="text-xs font-medium text-slate-600 mb-1 flex justify-between">
                                            Title
                                          </label>
                                          <Input
                                            value={item.title}
                                            onChange={(e) =>
                                              updateItem(
                                                item.id,
                                                "title",
                                                e.target.value,
                                              )
                                            }
                                            placeholder="Feature or task title"
                                            className={
                                              validationErrors[
                                                `item-${item.id}-title`
                                              ] ||
                                              localErrors[
                                                `item-${item.id}-title`
                                              ]
                                                ? "border-destructive"
                                                : ""
                                            }
                                          />
                                          {(validationErrors[
                                            `item-${item.id}-title`
                                          ] ||
                                            localErrors[
                                              `item-${item.id}-title`
                                            ]) && (
                                            <span className="text-xs text-destructive mt-1">
                                              {validationErrors[
                                                `item-${item.id}-title`
                                              ] ||
                                                localErrors[
                                                  `item-${item.id}-title`
                                                ]}
                                            </span>
                                          )}
                                        </div>
                                        <div>
                                          <label className="text-xs font-medium text-slate-600 mb-1 flex justify-between">
                                            Date Range
                                          </label>
                                          <DatePickerWithRange
                                            date={{
                                              from: item.startDate
                                                ? new Date(item.startDate)
                                                : undefined,
                                              to: item.endDate
                                                ? new Date(item.endDate)
                                                : undefined,
                                            }}
                                            setDate={(range) => {
                                              // Manually updating both fields
                                              const from = range?.from
                                                ? format(
                                                    range.from,
                                                    "yyyy-MM-dd",
                                                  )
                                                : "";
                                              const to = range?.to
                                                ? format(range.to, "yyyy-MM-dd")
                                                : "";
                                              setEditForm((prev) => ({
                                                ...prev,
                                                items: prev.items.map((i) =>
                                                  i.id === item.id
                                                    ? {
                                                        ...i,
                                                        startDate: from,
                                                        endDate: to,
                                                      }
                                                    : i,
                                                ),
                                              }));
                                            }}
                                            minDate={
                                              editForm.timelineStart
                                                ? new Date(
                                                    editForm.timelineStart,
                                                  )
                                                : undefined
                                            }
                                            maxDate={
                                              editForm.timelineEnd
                                                ? new Date(editForm.timelineEnd)
                                                : undefined
                                            }
                                            className={
                                              validationErrors[
                                                `item-${item.id}-startDate`
                                              ] ||
                                              validationErrors[
                                                `item-${item.id}-endDate`
                                              ] ||
                                              localErrors[
                                                `item-${item.id}-startDate`
                                              ] ||
                                              localErrors[
                                                `item-${item.id}-endDate`
                                              ]
                                                ? "border-destructive w-full"
                                                : "w-full"
                                            }
                                          />
                                          {(validationErrors[
                                            `item-${item.id}-startDate`
                                          ] ||
                                            localErrors[
                                              `item-${item.id}-startDate`
                                            ] ||
                                            validationErrors[
                                              `item-${item.id}-endDate`
                                            ] ||
                                            localErrors[
                                              `item-${item.id}-endDate`
                                            ]) && (
                                            <p className="text-xs text-destructive mt-1">
                                              {validationErrors[
                                                `item-${item.id}-startDate`
                                              ] ||
                                                localErrors[
                                                  `item-${item.id}-startDate`
                                                ] ||
                                                validationErrors[
                                                  `item-${item.id}-endDate`
                                                ] ||
                                                localErrors[
                                                  `item-${item.id}-endDate`
                                                ]}
                                            </p>
                                          )}
                                        </div>
                                      </div>

                                      <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">
                                          Description
                                        </label>
                                        <Textarea
                                          value={item.description || ""}
                                          onChange={(e) =>
                                            updateItem(
                                              item.id,
                                              "description",
                                              e.target.value,
                                            )
                                          }
                                          placeholder="Add details about this item..."
                                          rows={2}
                                        />
                                      </div>

                                      <div className="grid grid-cols-3 gap-2">
                                        <div>
                                          <label className="block text-xs font-medium text-slate-600 mb-1">
                                            Type
                                          </label>
                                          <Select
                                            value={item.type || "FEATURE"}
                                            onValueChange={(value) =>
                                              updateItem(item.id, "type", value)
                                            }
                                          >
                                            <SelectTrigger className="w-full h-8 text-xs">
                                              <SelectValue placeholder="Type" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="FEATURE">
                                                Feature
                                              </SelectItem>
                                              <SelectItem value="BUG">
                                                Bug
                                              </SelectItem>
                                              <SelectItem value="IMPROVEMENT">
                                                Improvement
                                              </SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>

                                        <div>
                                          <label className="block text-xs font-medium text-slate-600 mb-1">
                                            Priority
                                          </label>
                                          <Select
                                            value={item.priority || "MEDIUM"}
                                            onValueChange={(value) =>
                                              updateItem(
                                                item.id,
                                                "priority",
                                                value,
                                              )
                                            }
                                          >
                                            <SelectTrigger className="w-full h-8 text-xs">
                                              <SelectValue placeholder="Priority" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="LOW">
                                                Low
                                              </SelectItem>
                                              <SelectItem value="MEDIUM">
                                                Medium
                                              </SelectItem>
                                              <SelectItem value="HIGH">
                                                High
                                              </SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>

                                        <div>
                                          <label className="block text-xs font-medium text-slate-600 mb-1">
                                            Status
                                          </label>
                                          <Select
                                            value={item.status}
                                            onValueChange={(value) =>
                                              updateItem(
                                                item.id,
                                                "status",
                                                value,
                                              )
                                            }
                                          >
                                            <SelectTrigger className="w-full h-8 text-xs">
                                              <SelectValue placeholder="Status" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="PLANNED">
                                                Planned
                                              </SelectItem>
                                              <SelectItem value="IN_PROGRESS">
                                                In Progress
                                              </SelectItem>
                                              <SelectItem value="COMPLETED">
                                                Completed
                                              </SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="flex gap-2 pt-2">
                              <Button onClick={handleSave} size="sm">
                                Save
                              </Button>
                              {roadmaps.length > 1 && (
                                <Button
                                  onClick={handleCancel}
                                  variant="outline"
                                  size="sm"
                                >
                                  Close
                                </Button>
                              )}
                            </div>
                          </div>
                        ) : (
                          // View Mode
                          <div>
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <h3 className="text-xl font-bold text-slate-800">
                                    {roadmap.title}
                                  </h3>
                                  {roadmap.status && (
                                    <span
                                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(
                                        roadmap.status,
                                      )}`}
                                    >
                                      {roadmap.status}
                                    </span>
                                  )}
                                </div>
                                {roadmap.description && (
                                  <p className="text-sm text-slate-500 mb-1">
                                    {roadmap.description}
                                  </p>
                                )}
                                {roadmap.timelineStart &&
                                  roadmap.timelineEnd && (
                                    <p className="text-sm text-slate-500">
                                      {new Date(
                                        roadmap.timelineStart,
                                      ).toLocaleDateString("en-GB", {
                                        day: "numeric",
                                        month: "short",
                                        year: "numeric",
                                      })}{" "}
                                      -{" "}
                                      {new Date(
                                        roadmap.timelineEnd,
                                      ).toLocaleDateString("en-GB", {
                                        day: "numeric",
                                        month: "short",
                                        year: "numeric",
                                      })}
                                    </p>
                                  )}
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <div className="text-sm font-medium text-slate-600">
                                    {Math.round(progress)}%
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    {
                                      roadmap.items.filter(
                                        (i) => i.status === "COMPLETED",
                                      ).length
                                    }
                                    /{roadmap.items.length} completed
                                  </div>
                                </div>
                                {/* menu to edit items */}
                                {!readOnly && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        className="p-1 hover:bg-slate-100 rounded transition-colors"
                                        variant="ghost"
                                      >
                                        <MoreVertical className="w-5 h-5 text-slate-400" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() => handleEditClick(roadmap)}
                                      >
                                        Edit
                                      </DropdownMenuItem>
                                      {roadmaps.length > 1 && (
                                        <DropdownMenuItem
                                          onClick={() =>
                                            handleDelete(roadmap.id)
                                          }
                                          className="text-red-600 focus:text-red-600"
                                        >
                                          Delete
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            </div>

                            <div className="space-y-2">
                              {roadmap.items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group"
                                >
                                  <button
                                    onClick={() =>
                                      toggleItemStatus(roadmap.id, item.id)
                                    }
                                    className={`${!readOnly ? "cursor-pointer shrink-0 mt-0.5" : "cursor-default shrink-0 mt-0.5"}`}
                                  >
                                    {item.status === "COMPLETED" ? (
                                      <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                                        <Check
                                          className="w-2.5 h-2.5 text-white"
                                          strokeWidth={3}
                                        />
                                      </div>
                                    ) : item.status === "IN_PROGRESS" ? (
                                      <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                                      </div>
                                    ) : (
                                      <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                                    )}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          {getPriorityIcon(item.priority)}
                                          <span className="font-medium text-slate-700">
                                            {item.title}
                                          </span>
                                          {item.type && (
                                            <span className="px-1.5 py-0.5 text-xs text-slate-500 bg-slate-100 rounded">
                                              {item.type}
                                            </span>
                                          )}
                                        </div>
                                        {item.description && (
                                          <p className="text-sm text-slate-500 mb-1">
                                            {item.description}
                                          </p>
                                        )}
                                        {item.startDate && item.endDate && (
                                          <p className="text-sm text-slate-500">
                                            {new Date(
                                              item.startDate,
                                            ).toLocaleDateString("en-GB", {
                                              day: "numeric",
                                              month: "short",
                                              year: "numeric",
                                            })}{" "}
                                            -{" "}
                                            {new Date(
                                              item.endDate,
                                            ).toLocaleDateString("en-GB", {
                                              day: "numeric",
                                              month: "short",
                                              year: "numeric",
                                            })}
                                          </p>
                                        )}
                                      </div>
                                      <div className="flex flex-col items-end gap-2">
                                        <span
                                          className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(
                                            item.status,
                                          )}`}
                                        >
                                          {item.status.replace("_", " ")}
                                        </span>
                                        <div className="flex flex-wrap gap-1.5 items-center">
                                          {Array.isArray(
                                            item?.projectVersions,
                                          ) &&
                                            item.projectVersions.length > 0 &&
                                            item.projectVersions.map((pv) => (
                                              <Badge
                                                key={pv.id ?? pv.version}
                                                className="rounded-sm"
                                                size="sm"
                                              >
                                                {pv.release?.name ?? "—"} (
                                                {pv.version})
                                              </Badge>
                                            ))}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RoadMapManagement;
