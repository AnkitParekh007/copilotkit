import React, { useCallback, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAgent, useCopilotKit, useFrontendTool } from "@copilotkit/react-native";
import { z } from "zod";
import {
  MeetingTimePicker,
  type MeetingTimePickerStatus,
} from "./MeetingTimePicker";

interface HitlState {
  status: MeetingTimePickerStatus;
  reason?: string;
  duration?: number;
  selectedSlot?: { date: string; time: string; duration: string } | null;
}

export function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: "default" });

  const messages = agent?.messages ?? [];
  const isLoading = agent?.isRunning ?? false;

  // ── HITL: Schedule Meeting ──────────────────────────────────────────────
  const [hitl, setHitl] = useState<HitlState | null>(null);
  const respondRef = useRef<((result: string) => void) | null>(null);

  useFrontendTool({
    name: "scheduleTime",
    description: "Use human-in-the-loop to schedule a meeting with the user.",
    parameters: z.object({
      reasonForScheduling: z
        .string()
        .describe("Reason for scheduling, very brief - 5 words."),
      meetingDuration: z
        .number()
        .describe("Duration of the meeting in minutes"),
    }),
    handler: async (args) => {
      return new Promise<string>((resolve) => {
        respondRef.current = resolve;
        setHitl({
          status: "selecting",
          reason: args.reasonForScheduling,
          duration: args.meetingDuration,
        });
      });
    },
  });

  const handleHitlSelect = useCallback(
    (slot: { date: string; time: string; duration: string }) => {
      const result = `Meeting scheduled for ${slot.date} at ${slot.time} (${slot.duration}).`;
      respondRef.current?.(result);
      respondRef.current = null;
      setHitl((prev) =>
        prev ? { ...prev, status: "confirmed", selectedSlot: slot } : null,
      );
    },
    [],
  );

  const handleHitlDecline = useCallback(() => {
    respondRef.current?.(
      "The user declined all proposed meeting times. Please suggest alternative times or ask for their availability.",
    );
    respondRef.current = null;
    setHitl((prev) => (prev ? { ...prev, status: "declined" } : null));
  }, []);

  // ── Messages + HITL card as FlatList items ─────────────────────────────
  const listItems = React.useMemo(() => {
    const filtered = messages.filter(
      (m: any) =>
        m.role === "user" || (m.role === "assistant" && m.content),
    );
    if (hitl) {
      return [...filtered, { id: "__hitl__", role: "hitl" }];
    }
    return filtered;
  }, [messages, hitl]);

  // ── Send message ───────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading || !agent) {
      return;
    }
    setInputText("");
    agent.addMessage({
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    });
    try {
      await copilotkit.runAgent({ agent });
    } catch (error) {
      console.error("CopilotKit runAgent failed:", error);
    }
  }, [inputText, isLoading, agent, copilotkit]);

  const sendSuggestion = useCallback(
    (text: string) => {
      if (isLoading || !agent) return;
      agent.addMessage({
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      });
      copilotkit.runAgent({ agent }).catch(console.error);
    },
    [isLoading, agent, copilotkit],
  );

  // ── Render items ───────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      if (item.role === "hitl" && hitl) {
        return (
          <MeetingTimePicker
            status={hitl.status}
            reason={hitl.reason}
            duration={hitl.duration}
            selectedSlot={hitl.selectedSlot}
            onSelect={handleHitlSelect}
            onDecline={handleHitlDecline}
          />
        );
      }

      const isUser = item.role === "user";
      const content = item.content ?? "";
      if (!content && item.role === "tool") return null;

      return (
        <View
          style={[
            styles.messageBubble,
            isUser ? styles.userBubble : styles.assistantBubble,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isUser ? styles.userText : styles.assistantText,
            ]}
          >
            {typeof content === "string" ? content : JSON.stringify(content)}
          </Text>
        </View>
      );
    },
    [hitl, handleHitlSelect, handleHitlDecline],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>CopilotKit Chat</Text>
        <Text style={styles.headerSubtitle}>React Native · Human in the Loop</Text>
      </View>

      <FlatList
        ref={flatListRef}
        data={listItems}
        renderItem={renderItem}
        keyExtractor={(item: any, index: number) => item.id ?? String(index)}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: true })
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              Try asking to schedule a meeting
            </Text>
            <Pressable
              style={styles.suggestionPill}
              onPress={() =>
                sendSuggestion(
                  "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
                )
              }
            >
              <Text style={styles.suggestionText}>
                Schedule Meeting (HITL)
              </Text>
            </Pressable>
          </View>
        }
      />

      {isLoading && (
        <View style={styles.loadingBar}>
          <Text style={styles.loadingText}>Thinking...</Text>
        </View>
      )}

      <View style={[styles.inputRow, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          placeholderTextColor="#999"
          multiline
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[styles.sendButton, isLoading && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={isLoading || !inputText.trim()}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  header: {
    backgroundColor: "#6366f1",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  headerSubtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    marginTop: 2,
  },
  messageList: { padding: 16, flexGrow: 1 },
  messageBubble: {
    maxWidth: "80%",
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#6366f1",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    borderBottomLeftRadius: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  messageText: { fontSize: 15, lineHeight: 21 },
  userText: { color: "#fff" },
  assistantText: { color: "#1a1a1a" },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
    gap: 16,
  },
  emptyText: { color: "#999", fontSize: 16 },
  suggestionPill: {
    backgroundColor: "#e0e1ff",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  suggestionText: { color: "#6366f1", fontWeight: "600", fontSize: 14 },
  loadingBar: { paddingHorizontal: 16, paddingVertical: 6 },
  loadingText: { color: "#6366f1", fontSize: 13, fontStyle: "italic" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e0e0e0",
  },
  input: {
    flex: 1,
    backgroundColor: "#f0f0f0",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    maxHeight: 100,
    color: "#1a1a1a",
  },
  sendButton: {
    backgroundColor: "#6366f1",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginLeft: 8,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
