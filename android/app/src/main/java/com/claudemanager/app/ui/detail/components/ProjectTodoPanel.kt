package com.claudemanager.app.ui.detail.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.claudemanager.app.data.models.AgentMetadata
import com.claudemanager.app.data.models.PhaseStatus
import com.claudemanager.app.data.models.ProjectPhase
import com.claudemanager.app.data.models.ProjectStatus
import com.claudemanager.app.data.models.TodoStatus
import com.claudemanager.app.ui.theme.LumiCard
import com.claudemanager.app.ui.theme.LumiOnSurface
import com.claudemanager.app.ui.theme.LumiOnSurfaceSecondary
import com.claudemanager.app.ui.theme.LumiOnSurfaceTertiary
import com.claudemanager.app.ui.theme.LumiPurple500
import com.claudemanager.app.ui.theme.LumiSuccess
import com.claudemanager.app.ui.theme.phaseStatusColor

/**
 * Panel displaying projects and todos from the agent's metadata.
 *
 * Shows:
 * - Projects with their phases and progress bars
 * - Todos grouped by project, with checkmarks for completed items
 */
@Composable
fun ProjectTodoPanel(
    metadata: AgentMetadata?,
    modifier: Modifier = Modifier
) {
    val projects = metadata?.projects ?: emptyList()
    val todos = metadata?.todos ?: emptyList()

    if (projects.isEmpty() && todos.isEmpty()) {
        Box(
            modifier = modifier,
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "No projects or todos tracked",
                style = MaterialTheme.typography.bodyLarge,
                color = LumiOnSurfaceTertiary
            )
        }
        return
    }

    LazyColumn(
        modifier = modifier.padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        // Projects section
        if (projects.isNotEmpty()) {
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Projects",
                    style = MaterialTheme.typography.titleSmall,
                    color = LumiOnSurfaceSecondary
                )
                Spacer(modifier = Modifier.height(8.dp))
            }

            items(projects) { project ->
                ProjectCard(project = project)
                Spacer(modifier = Modifier.height(8.dp))
            }
        }

        // Todos section
        if (todos.isNotEmpty()) {
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Todos",
                    style = MaterialTheme.typography.titleSmall,
                    color = LumiOnSurfaceSecondary
                )
                Spacer(modifier = Modifier.height(8.dp))
            }

            // Group by project
            val grouped = todos.groupBy { it.project ?: "" }

            grouped.forEach { (project, projectTodos) ->
                if (project.isNotEmpty()) {
                    item(key = "project-header-$project") {
                        Text(
                            text = project,
                            style = MaterialTheme.typography.labelMedium,
                            color = LumiPurple500,
                            modifier = Modifier.padding(vertical = 4.dp)
                        )
                    }
                }

                items(projectTodos, key = { "todo-${it.name}-${it.project}" }) { todo ->
                    TodoItem(todo = todo)
                }

                item(key = "divider-$project") {
                    HorizontalDivider(
                        color = LumiCard,
                        thickness = 1.dp,
                        modifier = Modifier.padding(vertical = 4.dp)
                    )
                }
            }
        }

        item { Spacer(modifier = Modifier.height(16.dp)) }
    }
}

/**
 * A project card showing name, phases, and a mini progress bar.
 */
@Composable
private fun ProjectCard(project: ProjectStatus) {
    val phases = project.phases
    val completedCount = phases.count { it.status == PhaseStatus.COMPLETED }
    val totalCount = phases.size
    val progress = if (totalCount > 0) completedCount.toFloat() / totalCount else 0f

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(LumiCard)
            .padding(12.dp)
    ) {
        // Project name + progress
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = project.name,
                style = MaterialTheme.typography.titleSmall,
                color = LumiOnSurface
            )
            Text(
                text = "$completedCount/$totalCount",
                style = MaterialTheme.typography.labelSmall,
                color = LumiOnSurfaceSecondary
            )
        }

        if (phases.isNotEmpty()) {
            Spacer(modifier = Modifier.height(8.dp))

            // Mini progress bar
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp)),
                color = LumiSuccess,
                trackColor = LumiCard.copy(alpha = 0.5f)
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Phase list
            phases.forEach { phase ->
                PhaseItem(phase = phase)
            }
        }
    }
}

/**
 * A single phase item within a project, showing name and status chip.
 */
@Composable
private fun PhaseItem(phase: ProjectPhase) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = phase.name,
            style = MaterialTheme.typography.bodySmall,
            color = LumiOnSurface,
            modifier = Modifier.weight(1f)
        )

        Spacer(modifier = Modifier.width(8.dp))

        // Status chip
        val statusColor = phaseStatusColor(phase.status)
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .background(statusColor.copy(alpha = 0.15f))
                .padding(horizontal = 8.dp, vertical = 2.dp)
        ) {
            Text(
                text = phase.status.displayName,
                style = MaterialTheme.typography.labelSmall,
                color = statusColor
            )
        }
    }
}

/**
 * A todo item showing a checkbox icon, name, and optional project label.
 */
@Composable
private fun TodoItem(todo: TodoStatus) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Checkbox icon
        Icon(
            imageVector = if (todo.completed) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
            contentDescription = if (todo.completed) "Completed" else "Pending",
            tint = if (todo.completed) LumiSuccess else LumiOnSurfaceTertiary,
            modifier = Modifier.size(18.dp)
        )

        Spacer(modifier = Modifier.width(10.dp))

        // Todo name
        Text(
            text = todo.name,
            style = MaterialTheme.typography.bodyMedium,
            color = if (todo.completed) LumiOnSurfaceSecondary else LumiOnSurface,
            modifier = Modifier.weight(1f)
        )

        // Project label (if displayed in the ungrouped view or cross-project)
        if (todo.project != null) {
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = todo.project!!,
                style = MaterialTheme.typography.labelSmall,
                color = LumiOnSurfaceTertiary
            )
        }
    }
}
