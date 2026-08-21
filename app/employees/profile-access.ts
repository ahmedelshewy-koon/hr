export function canViewEmployeeProfile(input:{roleName:string;isSelf:boolean;isInManagedScope:boolean}){
  if(["Super Admin","HR Manager"].includes(input.roleName))return true;
  if(input.roleName==="Employee")return input.isSelf;
  if(input.roleName==="Department Manager")return input.isInManagedScope;
  return false;
}

export function profileFieldPolicy(input:{roleName:string;canEditEmployee:boolean;canViewUsers:boolean;canEditUsers:boolean}){
  const hr=["Super Admin","HR Manager"].includes(input.roleName);
  return {canEdit:hr&&input.canEditEmployee,canViewPrivate:hr,canViewAccount:hr&&input.canViewUsers,canManageAccount:hr&&input.canViewUsers&&input.canEditUsers};
}
