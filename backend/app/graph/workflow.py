from langgraph.graph import StateGraph, START, END
from app.core.state import StudioState
from app.graph.nodes import (
    ingest_input,
    assign_models,
    analyze_intent,
    prepare_ui_for_review,
    build_generation_plan,
    execute_generation,
    format_delivery
)

def route_after_review(state: StudioState) -> str:
    """Decides if we stop for user input or proceed to generation."""
    # Use .get() to avoid KeyErrors if status is missing
    status = state.get("status")
    
    if status == "awaiting_review":
        return "stop_for_user"
    elif status == "generating":
        return "continue_to_build"
    return "end"

def build_studio_graph():
    """Constructs the executable StateGraph."""
    graph = StateGraph(StudioState)

    # 1. Add Nodes
    graph.add_node("ingest", ingest_input)
    graph.add_node("assign_models", assign_models)
    graph.add_node("analyze_intent", analyze_intent)
    graph.add_node("prepare_ui", prepare_ui_for_review)
    graph.add_node("build_plan", build_generation_plan)
    graph.add_node("execute", execute_generation)
    graph.add_node("deliver", format_delivery)

    # 2. Analysis Phase
    graph.add_edge(START, "ingest")
    graph.add_edge("ingest", "assign_models")
    graph.add_edge("assign_models", "analyze_intent")
    graph.add_edge("analyze_intent", "prepare_ui")

    # 3. Conditional Logic
    graph.add_conditional_edges(
        "prepare_ui",
        route_after_review,
        {
            "stop_for_user": END,
            "continue_to_build": "build_plan"
        }
    )

    # 4. Generation Phase
    graph.add_edge("build_plan", "execute")
    graph.add_edge("execute", "deliver")
    graph.add_edge("deliver", END)

    return graph.compile()

# This is the variable main.py imports
studio_graph_app = build_studio_graph()