use crate::db::DashboardStats;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn stats_get_dashboard(
    state: State<'_, AppState>,
    period_days: Option<i64>,
) -> Result<DashboardStats, String> {
    state.db.stats_get_dashboard(period_days)
}
