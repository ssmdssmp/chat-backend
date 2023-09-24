const express = require("express");
const admin = require("firebase-admin");
const serviceAccount = require("./chatnew-b6476-firebase-adminsdk-ltqlm-5dd8120770.json");
const app = express();
const http = require("http").Server(app);
const io = require("socket.io")(http); // Import and use socket.io
require("dotenv").config();
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.DB_URL,
});

const port = process.env.PORT;
const router = express.Router();
const RTDatabase = admin.database();

app.use(express.json());
const getUserData = async (id) => {
  try {
    const ref = RTDatabase.ref(`userData/${id}`);
    const snapshot = await ref.once("value");
    const data = snapshot.val();
    return data;
  } catch (error) {
    console.error("Error getting chat:", error);
    throw error;
  }
};
const getChatById = async (userId, chatId) => {
  try {
    const chatSnapshot = await RTDatabase.ref(`chats/${chatId}`).once("value");

    if (!chatSnapshot.exists()) {
      return null;
    }

    const chatData = chatSnapshot.val();
    const participants = Object.keys(chatData.participants).filter(
      (participant) => participant !== userId
    );

    if (participants.length === 0) {
      return null;
    }

    const receiverData = await getUserData(participants[0]);

    const messagesArray = Object.entries(chatData.messages)
      .map(([messageId, messageData]) => ({
        id: messageId,
        sender: messageData.sender,
        text: messageData.text,
        timestamp: messageData.timestamp,
      }))
      .sort((a, b) => {
        const dateA = new Date(a.timestamp);
        const dateB = new Date(b.timestamp);
        return dateA - dateB;
      });

    const chatWithReceiverData = {
      receiver: receiverData,
      chat: {
        ...chatData,
        id: chatId,
        messages: messagesArray,
      },
    };

    return chatWithReceiverData;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

const getUserChats = async (userId) => {
  try {
    const data = await RTDatabase.ref("chats")
      .orderByChild(`participants/${userId}`)
      .equalTo(true)
      .once("value");
    let chatsWithReceiverData = [];
    if (data.val()) {
      const promises = Object.entries(data.val()).map(
        async ([chatId, chatData]) => {
          if (chatData !== undefined) {
            const receiverPromises = Object.keys(chatData.participants).map(
              async (participant) => {
                if (participant !== userId) {
                  try {
                    const receiverData = await getUserData(participant);
                    const messagesArray = Object.entries(chatData.messages)
                      .map(([messageId, messageData]) => ({
                        id: messageId,
                        sender: messageData.sender,
                        text: messageData.text,
                        timestamp: messageData.timestamp,
                      }))
                      .sort((a, b) => {
                        const dateA = new Date(a.timestamp);
                        const dateB = new Date(b.timestamp);
                        return dateA - dateB;
                      });
                    chatsWithReceiverData.push({
                      receiver: receiverData,
                      chat: {
                        ...chatData,
                        id: chatId,
                        messages: messagesArray,
                      },
                    });
                  } catch (error) {
                    console.error(error);
                  }
                }
              }
            );

            await Promise.all(receiverPromises);
          }
        }
      );
      await Promise.all(promises);
    } else {
    }

    return chatsWithReceiverData;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
const userSockets = new Map();
io.on("connection", (socket) => {
  if (socket.handshake.query.userId) {
    const userId = socket.handshake.query.userId;
    userSockets.set(userId, socket);
    socket.join(userId);

    getUserChats(userId).then((chatsWithParticipantsData) => {
      io.to(userId).emit("getChats", JSON.stringify(chatsWithParticipantsData));
      if (chatsWithParticipantsData.length === 0) {
        io.to(userId).emit("getChats", JSON.stringify([]));
      } else {
        io.to(userId).emit(
          "getChats",
          JSON.stringify(chatsWithParticipantsData)
        );
      }
    });

    RTDatabase.ref("chats")
      .orderByChild(`participants/${userId}`)
      .equalTo(true)
      .on("child_removed", (childSnapshot) => {
        io.to(userId).emit("deleted", JSON.stringify(childSnapshot.key));
      });

    RTDatabase.ref("chats")
      .orderByChild(`participants/${userId}`)
      .equalTo(true)
      .on("child_added", (childSnapshot) => {
        getChatById(userId, childSnapshot.key).then((data) => {
          io.to(userId).emit(
            "new",
            JSON.stringify({
              chat: {
                ...data.chat,
                messages: [{ ...data.chat.messages[0], status: "sent" }],
              },
              receiver: data.receiver,
            })
          );
        });
      });

    socket.on("disconnect", () => {
      socket.leave(userId);
      userSockets.delete(userId);
    });
  }
});

router.get("/:id", async (req, res) => {
  const id = req.params.id;

  RTDatabase.ref("chats")
    .orderByChild(`participants/${id}`)
    .equalTo(true)
    .once("value")
    .then((snapshot) => {
      const data = snapshot.val();

      res.status(200).json(data);
    })
    .catch((error) => {
      res.status(500).json({ error: error.message });
    });
});

app.use("/", router);

http.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
