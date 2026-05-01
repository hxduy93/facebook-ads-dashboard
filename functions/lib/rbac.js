// RBAC (Role-Based Access Control) cho Doscom ERP
// 6 levels: CEO > COO > TP > Leader > Phó Leader > Staff

export const ROLE_LEVELS = {
  CEO: 60,
  COO: 50,
  DEPT_HEAD: 40,        // TP Marketing, TP Kinh doanh, etc.
  TEAM_LEADER: 30,      // Leader của team con (Content/FB/GG/TikTok/Shopee/Sales/CSKH/Warehouse)
  DEP_LEADER: 20,       // Phó leader
  STAFF: 10,
};

export const ROLE_LABELS = {
  60: "CEO",
  50: "Giám đốc vận hành",
  40: "Trưởng phòng",
  30: "Leader",
  20: "Phó Leader",
  10: "Nhân viên",
};

// Lấy thông tin employee từ email session (qua D1)
export async function getEmployeeFromEmail(env, email) {
  if (!env.DB) return null;
  if (!email) return null;
  try {
    const r = await env.DB.prepare(
      "SELECT * FROM employees WHERE email = ? AND active = 1 LIMIT 1"
    ).bind(email.toLowerCase()).first();
    return r || null;
  } catch (e) {
    console.error("getEmployeeFromEmail fail:", e.message);
    return null;
  }
}

// Check user có quyền tối thiểu level không
export function requireLevel(employee, minLevel) {
  if (!employee) return false;
  return Number(employee.role_level) >= minLevel;
}

// Check user thuộc dept không (CEO/COO bypass)
export function isInDepartment(employee, dept) {
  if (!employee) return false;
  if (employee.role_level >= 50) return true; // CEO + COO see all
  return employee.department_id === dept;
}

// Check user thuộc team không (Leader+ bypass cho dept mình)
export function isInTeam(employee, team) {
  if (!employee) return false;
  if (employee.role_level >= 50) return true;
  if (employee.role_level >= 40 && employee.department_id) {
    // TP có quyền trên tất cả team trong dept
    return true;
  }
  return employee.team_id === team;
}

// Main permission check function
// resource: { department_id?, team_id?, assigned_to?, ...}
// action: 'read' | 'write' | 'delete' | 'admin'
export function canAccess(employee, resource, action = "read") {
  if (!employee) return false;

  // Level 60+ (CEO): full power
  if (employee.role_level >= 60) return true;

  // Level 50 (COO): full except top admin (sửa permission user khác)
  if (employee.role_level >= 50) {
    if (action === "admin_users") return false;
    return true;
  }

  // Level 40 (Dept head, vd TP Marketing):
  if (employee.role_level >= 40) {
    if (resource?.department_id === employee.department_id) return true;
    if (action === "read") return true; // read-only data dept khác
    return false;
  }

  // Level 30 (Team leader):
  if (employee.role_level >= 30) {
    if (resource?.team_id === employee.team_id) return true;
    if (action === "read" && resource?.department_id === employee.department_id) return true;
    return false;
  }

  // Level 20 (Phó leader): same level 30 nhưng giảm vài action sensitive
  if (employee.role_level >= 20) {
    if (resource?.team_id === employee.team_id) {
      if (action === "delete" || action === "admin") return false;
      return true;
    }
    if (action === "read" && resource?.department_id === employee.department_id) return true;
    return false;
  }

  // Level 10 (Staff): only assigned + own team readonly
  if (employee.role_level >= 10) {
    if (resource?.assigned_to === employee.id || resource?.assigned_to_employee_id === employee.id) {
      if (action === "delete" || action === "admin") return false;
      return true;
    }
    if (action === "read" && resource?.team_id === employee.team_id) return true;
    return false;
  }

  return false;
}

// Throw if not authorized — dùng trong API endpoint
export function assertCanAccess(employee, resource, action = "read") {
  if (!canAccess(employee, resource, action)) {
    const err = new Error(`Forbidden: ${employee?.email || "anon"} không đủ quyền ${action}`);
    err.statusCode = 403;
    throw err;
  }
}

// Filter list of resources theo permission (for list endpoints)
export function filterAccessible(employee, resources, action = "read") {
  if (!Array.isArray(resources)) return [];
  return resources.filter(r => canAccess(employee, r, action));
}
