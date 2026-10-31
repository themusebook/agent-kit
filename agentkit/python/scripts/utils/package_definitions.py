"""
Centralized package definitions and utilities for version management.
"""
from typing import Dict, List, Optional

# Core package definition
CORE_PACKAGE = {
    "name": "musebook-agent-kit",
    "package_name": "musebook-agent-kit",  # package name in dependencies
    "path": "../musebook-agent-kit/pyproject.toml",
    "files": [
        {
            "path": "../musebook-agent-kit/pyproject.toml",
            "version_key": "version"
        },
        {
            "path": "../musebook-agent-kit/docs/conf.py",
            "version_key": "release"
        },
        {
            "path": "../musebook-agent-kit/musebook_agent_kit/__version__.py",
            "version_key": "__version__"
        }
    ]
}

# Framework package definitions
FRAMEWORK_PACKAGES = [
    {
        "name": "framework-extensions/langchain",
        "package_name": "musebook-agent-kit-langchain",
        "path": "../framework-extensions/langchain/pyproject.toml",
        "files": [
            {
                "path": "../framework-extensions/langchain/pyproject.toml",
                "version_key": "version"
            },
            {
                "path": "../framework-extensions/langchain/docs/conf.py",
                "version_key": "release"
            }
        ]
    },
    {
        "name": "framework-extensions/openai-agents-sdk",
        "package_name": "musebook-agent-kit-openai-agents-sdk",
        "path": "../framework-extensions/openai-agents-sdk/pyproject.toml",
        "files": [
            {
                "path": "../framework-extensions/openai-agents-sdk/pyproject.toml",
                "version_key": "version"
            }
        ]
    },
    {
        "name": "framework-extensions/strands-agents",
        "package_name": "musebook-agent-kit-strands-agents",
        "path": "../framework-extensions/strands-agents/pyproject.toml",
        "files": [
            {
                "path": "../framework-extensions/strands-agents/pyproject.toml",
                "version_key": "version"
            }
        ]
    },
    {
        "name": "framework-extensions/pydantic-ai",
        "package_name": "musebook-agent-kit-pydantic-ai",
        "path": "../framework-extensions/pydantic-ai/pyproject.toml",
        "files": [
            {
                "path": "../framework-extensions/pydantic-ai/pyproject.toml",
                "version_key": "version"
            }
        ]
    },
    {
        "name": "framework-extensions/autogen",
        "package_name": "musebook-agent-kit-autogen",
        "path": "../framework-extensions/autogen/pyproject.toml",
        "files": [
            {
                "path": "../framework-extensions/autogen/pyproject.toml",
                "version_key": "version"
            }
        ]
    }
]

# Utility package definitions
UTILITY_PACKAGES = [
    {
        "name": "create-musebook-agent",
        "package_name": "create-musebook-agent-python",
        "path": "../create-musebook-agent/pyproject.toml",
        "files": [
            {
                "path": "../create-musebook-agent/pyproject.toml",
                "version_key": "version"
            }
        ],
        "templates": [
            {
                "subtitle": "beginner template",
                "path": "../create-musebook-agent/templates/beginner/pyproject.toml.jinja",
                "version_key": "version"
            },
            {
                "subtitle": "chatbot template",
                "path": "../create-musebook-agent/templates/chatbot/pyproject.toml.jinja",
                "version_key": "version"
            }
        ]
    }
]

# All packages combined
ALL_PACKAGES = [CORE_PACKAGE] + FRAMEWORK_PACKAGES + UTILITY_PACKAGES

def get_packages_by_names(names: List[str]) -> List[Dict]:
    """Get package configurations by their names."""
    return [pkg for pkg in ALL_PACKAGES if pkg["name"] in names]

def get_package_by_name(name: str) -> Optional[Dict]:
    """Get a single package configuration by name."""
    matches = [pkg for pkg in ALL_PACKAGES if pkg["name"] == name]
    return matches[0] if matches else None

def get_dependency_check_info() -> List[Dict]:
    """Get dependency check information for core and framework packages."""
    return [
        {
            "path": pkg["path"],
            "package_name": pkg["package_name"]
        }
        for pkg in [CORE_PACKAGE] + FRAMEWORK_PACKAGES
    ]

def get_version_files(packages: List[Dict]) -> List[Dict]:
    """Transform package configs into version file configs."""
    return [
        {
            "name": pkg["name"],
            "files": pkg["files"]
        }
        for pkg in packages
    ]

def get_dependency_files(packages: List[Dict]) -> List[Dict]:
    """Transform package configs into dependency file configs with templates."""
    return [
        {
            "name": pkg["name"],
            "files": [
                *([t for t in pkg.get("templates", [])]),  # Include templates if they exist
                *(pkg.get("files", []))  # Include regular files
            ]
        }
        for pkg in packages
    ] 