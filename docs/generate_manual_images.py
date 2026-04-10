"""Generate base64 image variables for the user manual."""
import base64, os

SCREENSHOTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')

def img_b64(filename):
    path = os.path.join(SCREENSHOTS_DIR, filename)
    with open(path, 'rb') as f:
        data = base64.b64encode(f.read()).decode('ascii')
    return f'data:image/png;base64,{data}'

# Export all screenshots as data URIs
DASHBOARD = img_b64('web_dashboard.png')
AGENT_DETAIL = img_b64('web_agent_detail.png')
PROJECTS = img_b64('web_projects.png')
PROJECT_DETAIL = img_b64('web_project_detail.png')
SETTINGS = img_b64('web_settings.png')
WORKFLOWS = img_b64('web_workflows.png')

if __name__ == '__main__':
    for name in ['DASHBOARD', 'AGENT_DETAIL', 'PROJECTS', 'PROJECT_DETAIL', 'SETTINGS', 'WORKFLOWS']:
        val = locals()[name]
        print(f'{name}: {len(val)} chars')
