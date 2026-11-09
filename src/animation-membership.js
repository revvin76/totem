export function animationMembership(mesh, group, assignedGroup) {
  const inCurrentGroup = Boolean(group && assignedGroup?.id === group.id);
  return {
    inCurrentGroup,
    action: inCurrentGroup ? "Remove" : "Add",
    disabled: !group || Boolean(assignedGroup && !inCurrentGroup),
    label: inCurrentGroup
      ? `Remove ${mesh.name} from ${group.name}`
      : assignedGroup
        ? `${mesh.name} is already in ${assignedGroup.name}`
        : `Add ${mesh.name} to ${group?.name ?? "the current group"}`,
  };
}
